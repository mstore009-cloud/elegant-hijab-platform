import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Store, User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getOperationalStoreContext } from "../stores/db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  operationalStore: Store | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let operationalStore: Store | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
    const storeContext = await getOperationalStoreContext(user);
    operationalStore = storeContext?.store ?? null;
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    operationalStore,
  };
}
