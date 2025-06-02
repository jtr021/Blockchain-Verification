// utils/id.js
import { randomUUID } from 'crypto';

export function makeFileId(fileName, fixedId) {

  return fixedId ?? `${fileName}-${randomUUID()}`;
}
