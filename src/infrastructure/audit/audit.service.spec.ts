import { AuditService } from './audit.service';

describe('AuditService.diff', () => {
  it('records only the fields that changed', () => {
    const diff = AuditService.diff(
      { fullName: 'Kannan S', phone: '0771111111', address: 'Jaffna' },
      { fullName: 'Kannan Sivam', phone: '0771111111', address: 'Jaffna' },
    );

    expect(diff).toEqual({ fullName: { from: 'Kannan S', to: 'Kannan Sivam' } });
  });

  it('ignores keys the caller left undefined', () => {
    expect(AuditService.diff({ phone: '077' }, { phone: undefined })).toBeUndefined();
  });

  it('returns undefined when nothing changed', () => {
    expect(AuditService.diff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBeUndefined();
  });

  it('normalises a missing previous value to null', () => {
    expect(AuditService.diff({}, { phone: '0777654321' })).toEqual({
      phone: { from: null, to: '0777654321' },
    });
  });
});
