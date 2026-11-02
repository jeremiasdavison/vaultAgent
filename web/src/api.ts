export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method ?? "GET",
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "llaverito",
      ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { detail?: unknown };
  if (!response.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : String(item))).join("; ")
      : typeof detail === "string"
        ? detail
        : `Error ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}
