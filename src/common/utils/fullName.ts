// Display name from a User's first/last name. `lastName` is optional for students (stored
// as "" when omitted), so join only the non-empty parts — no trailing space.
export function fullName(user: { firstName: string; lastName: string }): string {
  return [user.firstName, user.lastName].map((p) => p.trim()).filter(Boolean).join(" ");
}
