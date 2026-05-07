/** @spec api/route */
export interface RouteHandler {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: () => unknown;
}

/** @spec api/controller */
export class UserController {
  routes: RouteHandler[] = [
    { method: 'GET', path: '/users', handler: () => this.list() },
    { method: 'POST', path: '/users', handler: () => this.create() },
  ];

  list(): string[] {
    return [];
  }

  create(): { id: string } {
    return { id: '1' };
  }
}
