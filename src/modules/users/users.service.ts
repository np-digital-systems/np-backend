import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { Prisma } from '../../generated/prisma/client';
import { UserRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_SELECT = {
  id: true,
  nameTa: true,
  fullName: true,
  email: true,
  phone: true,
  address: true,
  role: true,
  isActive: true,
  memberNo: true,
  joinedOn: true,
  subscribes: true,
  lastLoginAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserView = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryUsersDto): Promise<PageDto<UserView>> {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      isActive: query.isActive,
      memberNo: query.membersOnly ? { not: null } : undefined,
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { memberNo: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: query.order },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PageDto(data, new PageMetaDto(query.page, query.limit, total));
  }

  async findByIdOrFail(id: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });

    if (!user) throw new NotFoundException(`User ${id} was not found`);

    return user;
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    const role = dto.role ?? UserRole.user;

    if (role !== UserRole.user && (!dto.email || !dto.password)) {
      throw new BadRequestException('Staff accounts require both an email and a password');
    }

    return this.prisma.user.create({
      data: {
        nameTa: dto.nameTa,
        fullName: dto.fullName,
        email: dto.email,
        passwordHash: dto.password
          ? await hash(dto.password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })
          : undefined,
        phone: dto.phone,
        address: dto.address ?? '',
        role,
        joinedOn: dto.joinedOn ? new Date(dto.joinedOn) : undefined,
        subscribes: dto.subscribes ?? false,
        notes: dto.notes,
      },
      select: USER_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserView> {
    await this.findByIdOrFail(id);

    return this.prisma.user.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        role: dto.role,
        joinedOn: dto.joinedOn ? new Date(dto.joinedOn) : undefined,
        subscribes: dto.subscribes,
        notes: dto.notes,
      },
      select: USER_SELECT,
    });
  }

  async deactivate(id: string): Promise<UserView> {
    await this.findByIdOrFail(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return tx.user.update({ where: { id }, data: { isActive: false }, select: USER_SELECT });
    });
  }
}
