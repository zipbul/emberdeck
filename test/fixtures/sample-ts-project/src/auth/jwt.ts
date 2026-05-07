/** @spec auth/jwt-token */
export class JwtIssuer {
  constructor(private readonly secret: string) {}

  issue(subject: string): string {
    return `${subject}.${this.secret}.signed`;
  }

  verify(token: string): boolean {
    return token.endsWith('.signed');
  }
}

export function decodeJwt(token: string): { subject: string } | null {
  const parts = token.split('.');
  if (parts.length < 3) return null;
  return { subject: parts[0]! };
}
