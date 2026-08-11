import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/AppError.js";
import { parseDurationMs } from "../../common/utils/duration.js";
import * as authService from "./auth.service.js";
import type { LoginBody } from "./auth.schema.js";

const REFRESH_COOKIE_NAME = "refreshToken";

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/v1/auth",
  maxAge: parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
};

export async function login(req: Request, res: Response): Promise<void> {
  const { accessToken, refreshToken, user } = await authService.login(req.body as LoginBody);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
  res.status(200).json({ accessToken, user });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawRefreshToken) {
    throw new UnauthorizedError("Missing refresh token");
  }

  const { accessToken, refreshToken, user } = await authService.refresh(rawRefreshToken);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
  res.status(200).json({ accessToken, user });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (rawRefreshToken) {
    await authService.logout(rawRefreshToken);
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
  res.status(204).send();
}
