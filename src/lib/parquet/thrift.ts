// A writer for the Thrift compact protocol, the encoding of Parquet's footer and page headers
// (specs/005 research R3). It writes only what Parquet needs: structs, i32, i64, booleans, binary and
// strings, and lists. Nothing is read back here; the tests compare bytes with the protocol's published
// vectors, and the written files are opened by two independent readers.

/** Compact protocol type ids for fields and list elements. */
export const TType = {
  BOOL_TRUE: 1,
  BOOL_FALSE: 2,
  BYTE: 3,
  I16: 4,
  I32: 5,
  I64: 6,
  DOUBLE: 7,
  BINARY: 8,
  LIST: 9,
  SET: 10,
  MAP: 11,
  STRUCT: 12,
} as const;

/** An unsigned LEB128 varint of a non-negative value. */
export function varint(value: bigint | number): number[] {
  let v = BigInt(value);
  if (v < 0n) throw new Error("varint of a negative number");
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

/** Zigzag: maps small signed numbers to small unsigned ones, for a 64-bit range. */
export function zigzag(value: bigint | number): bigint {
  const v = BigInt(value);
  return BigInt.asUintN(64, (v << 1n) ^ (v >> 63n));
}

const encoder = new TextEncoder();

export class ThriftWriter {
  private buffer = new Uint8Array(1024);
  private length = 0;
  /** The last field id written in each open struct (the delta base). */
  private lastField: number[] = [];

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  private byte(b: number): void {
    this.ensure(1);
    this.buffer[this.length++] = b;
  }

  private bytes(data: ArrayLike<number>): void {
    this.ensure(data.length);
    this.buffer.set(data as ArrayLike<number>, this.length);
    this.length += data.length;
  }

  private open(): number {
    if (this.lastField.length === 0) throw new Error("A field must be written inside a struct.");
    return this.lastField.length - 1;
  }

  /** The header of a field: the id as a delta from the last one when it fits in four bits. */
  private header(id: number, type: number): void {
    const depth = this.open();
    const delta = id - this.lastField[depth];
    if (delta > 0 && delta <= 15) this.byte((delta << 4) | type);
    else {
      this.byte(type);
      this.bytes(varint(zigzag(id)));
    }
    this.lastField[depth] = id;
  }

  /** Starts a struct: at the top, as a list element, or (after `fieldStructBegin`) as a field's value. */
  structBegin(): void {
    this.lastField.push(0);
  }

  /** Ends the open struct with the stop byte. */
  structEnd(): void {
    if (this.lastField.length === 0) throw new Error("There is no open struct to end.");
    this.byte(0);
    this.lastField.pop();
  }

  fieldStructBegin(id: number): void {
    this.header(id, TType.STRUCT);
    this.structBegin();
  }

  fieldI32(id: number, value: number): void {
    this.header(id, TType.I32);
    this.bytes(varint(zigzag(value)));
  }

  fieldI64(id: number, value: number | bigint): void {
    this.header(id, TType.I64);
    this.bytes(varint(zigzag(value)));
  }

  fieldBool(id: number, value: boolean): void {
    this.header(id, value ? TType.BOOL_TRUE : TType.BOOL_FALSE);
  }

  fieldBinary(id: number, value: Uint8Array): void {
    this.header(id, TType.BINARY);
    this.bytes(varint(value.length));
    this.bytes(value);
  }

  fieldString(id: number, value: string): void {
    this.fieldBinary(id, encoder.encode(value));
  }

  /** The header of a list field; the elements follow with `i32`, `string`, `structBegin` and so on. */
  fieldListBegin(id: number, elementType: number, size: number): void {
    this.header(id, TType.LIST);
    if (size < 15) this.byte((size << 4) | elementType);
    else {
      this.byte(0xf0 | elementType);
      this.bytes(varint(size));
    }
  }

  /** A list element. */
  i32(value: number): void {
    this.bytes(varint(zigzag(value)));
  }

  string(value: string): void {
    const data = encoder.encode(value);
    this.bytes(varint(data.length));
    this.bytes(data);
  }

  /** The bytes written so far. */
  finish(): Uint8Array {
    if (this.lastField.length !== 0) throw new Error("A struct was left open.");
    return this.buffer.slice(0, this.length);
  }
}
