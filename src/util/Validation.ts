export function getEnvironmentVariableOrThrow(name: string): string {
  if (!process.env[name]) throw new Error(`process.env.${name} is undefined`);
  return process.env[name] as string;
}

// https://stackoverflow.com/questions/52127082/ensure-existance-of-optional-property-in-typescript-interface
/**
 * Returns a type MakeRequired<T, K> which extends T.
 * This subtype removes the optional property from field K on type T .
 */
export type MakeRequired<T, K extends keyof T> = Pick<
  T,
  Exclude<keyof T, K>
> & {
  [P in K]-?: Exclude<T[P], undefined>;
};

/**
 * Performs a type guard ensuring that an optional `field` is present
 * in `o`, and informs Typescript that the field can be accessed safely.
 * @param o Object to validate.
 * @param field `optional`-type fields to validate.
 */
export function checkField<T, K extends keyof T>(
  o: T | MakeRequired<T, K>,
  field: K
): o is MakeRequired<T, K> {
  return !!o[field];
}

/**
 * Performs a type guard ensuring that multiple optional `fields` are present
 * in `o`, and informs Typescript that the fields can be accessed safely.
 * @param o Object to validate.
 * @param fields `optional`-type fields to validate.
 */
export function checkFields<T, K extends keyof T>(
  o: T | MakeRequired<T, K>,
  ...fields: K[]
): o is MakeRequired<T, K> {
  return fields.every(f => !!o[f]);
}

/**
 * Performs a type guard on many objects `o[]`, ensuring that the given
 * `field` is present on all objects and informing Typescript that the field
 * can be safely accessed.
 * @param o Object to validate.
 * @param field `optional`-type field to validate.
 */
export function checkElementsForField<T, K extends keyof T>(
  o: T[] | MakeRequired<T, K>[],
  field: K
): o is MakeRequired<T, K>[] {
  for (const e of o) {
    if (!checkFields(e, field)) return false;
  }
  return true;
}
/**
 * Performs a type guard on many objects `o[]`, ensuring that the given
 * `fields` are present on all objects and informing Typescript that the fields
 * can be safely accessed.
 * @param o Object to validate.
 * @param fields `optional`-type fields to validate.
 */
export function checkElementsForFields<T, K extends keyof T>(
  o: T[] | MakeRequired<T, K>[],
  ...fields: K[]
): o is MakeRequired<T, K>[] {
  for (const e of o) {
    if (!checkFields(e, ...fields)) return false;
  }
  return true;
}
