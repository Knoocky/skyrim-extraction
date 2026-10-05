export class DomainError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.name = 'DomainError'; this.code = code; }
}
