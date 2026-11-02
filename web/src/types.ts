export type Role = "admin" | "editor" | "viewer";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  auth_source: string;
  department: string | null;
};

export type Folder = {
  id: string;
  name: string;
  description: string;
  level: "read" | "write";
};

export type CredType =
  | "api_key"
  | "bearer_token"
  | "basic_auth"
  | "password"
  | "ssh_key"
  | "ssh_password";

export type Credential = {
  id: string;
  ref: string;
  folder_id: string;
  folder: string;
  name: string;
  type: CredType | string;
  meta: Record<string, unknown>;
  sensitive: boolean;
  allow_reveal: boolean;
  version: number;
  can_write: boolean;
  access: "shared" | "folder";
  share_level?: "use" | "reveal";
  shared_until?: string | null;
  shared_permanent?: boolean;
  updated_at: string;
};

export const TYPE_LABEL: Record<string, string> = {
  api_key: "API key",
  bearer_token: "Token Bearer",
  basic_auth: "HTTP Basic",
  password: "Contraseña",
  ssh_key: "SSH · clave",
  ssh_password: "SSH · contraseña",
};

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
