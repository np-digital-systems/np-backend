import type { Prisma } from '../../generated/prisma/client';

const yearBounds = (year: number) => ({
  gte: new Date(Date.UTC(year, 0, 1)),
  lt: new Date(Date.UTC(year + 1, 0, 1)),
});

// A member sponsors a pooja in a year when an occurrence scheduled in it names them.
export function sponsorsPoojaIn(year: number): Prisma.MemberWhereInput {
  return { party: { eventsSponsored: { some: { scheduledDate: yearBounds(year) } } } };
}

// Each year starts empty: that year's pooja sponsors owe the sanththa, and so does
// any other member added to that year's list.
export function owesSanththaIn(year: number): Prisma.MemberWhereInput {
  return { OR: [sponsorsPoojaIn(year), { enrolments: { some: { year } } }] };
}

export function sponsoredOccurrencesIn(year: number) {
  return { where: { scheduledDate: yearBounds(year) }, select: { id: true }, take: 1 } as const;
}
