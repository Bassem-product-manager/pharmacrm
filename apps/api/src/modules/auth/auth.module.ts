import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RefreshTokenStore } from "./refresh-token.store";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenStore],
  exports: [AuthService, RefreshTokenStore],
})
export class AuthModule {}
