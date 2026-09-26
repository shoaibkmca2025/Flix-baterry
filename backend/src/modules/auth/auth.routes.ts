import type { FastifyInstance } from 'fastify';
import * as controller from './auth.controller';
import { AdminLoginBody, OtpRequestBody, OtpVerifyBody, PasswordForgotBody, PasswordResetBody, RefreshBody } from './auth.validation';

// M-02 auth — architecture.md §19. Every route here is public: nobody is signed in yet
// when they call it. Thin: schema declares the contract, controller does the work.
export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/otp/request', { schema: { body: OtpRequestBody } }, controller.otpRequest);
  app.post('/otp/verify', { schema: { body: OtpVerifyBody } }, controller.otpVerify);
  app.post('/login', { schema: { body: AdminLoginBody } }, controller.login);
  app.post('/password/forgot', { schema: { body: PasswordForgotBody } }, controller.passwordForgot);
  app.post('/password/reset', { schema: { body: PasswordResetBody } }, controller.passwordReset);
  app.post('/refresh', { schema: { body: RefreshBody } }, controller.refresh);
}
