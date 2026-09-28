interface MeDeps {
  findUser: (id: string) => Promise<{ id: string; email: string } | undefined>;
}

export function createMe(deps: MeDeps) {
  return (userId: string) => deps.findUser(userId);
}
