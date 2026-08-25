declare global {
  interface BigInt {
    toJSON(): string;
  }
}

export function enableBigIntSerialization(): void {
  BigInt.prototype.toJSON = function toJSON(this: bigint): string {
    return this.toString();
  };
}
