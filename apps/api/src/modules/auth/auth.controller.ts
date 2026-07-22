import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { loginSchema, signupSchema } from "@pharmacrm/shared";
import { Public } from "../../common/guards/jwt.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { AuthService, TokenPair } from "./auth.service";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("signup")
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: ReturnType<typeof signupSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.signup(body);
    setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  // 5/min per IP (default tracker) AND 5/min per phone (custom tracker) — R15/T6
  @Throttle({ "login-ip": { limit: 5, ttl: 60_000 }, "login-phone": { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.login(body);
    setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? "";
    const pair: TokenPair = await this.auth.refresh(token);
    setRefreshCookie(res, pair.refreshToken);
    return { accessToken: pair.accessToken };
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  }
}
