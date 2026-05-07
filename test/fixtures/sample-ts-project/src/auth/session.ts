import { JwtIssuer, decodeJwt } from './jwt';

/** @spec auth/session */
export class SessionStore {
  private readonly sessions = new Map<string, number>();
  private readonly issuer: JwtIssuer;

  constructor(secret: string) {
    this.issuer = new JwtIssuer(secret);
  }

  open(subject: string): string {
    const token = this.issuer.issue(subject);
    this.sessions.set(subject, Date.now());
    return token;
  }

  close(token: string): boolean {
    const decoded = decodeJwt(token);
    if (!decoded) return false;
    return this.sessions.delete(decoded.subject);
  }
}
