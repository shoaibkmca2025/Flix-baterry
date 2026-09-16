import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCtx } from '../../middleware/context';
import * as service from './auth.service';
import type { AdminLoginBody, OtpRequestBody, OtpVerifyBody, PasswordForgotBody, PasswordResetBody } from './auth.validation';

export async function otpRequest(request: FastifyRequest<{ Body: OtpRequestBody }>, reply: FastifyReply) {
  const result = await service.requestOtp(buildCtx(request), request.body);
  reply.status(200).send(result);
}

export async function otpVerify(request: FastifyRequest<{ Body: OtpVerifyBody }>, reply: FastifyReply) {
  const result = await service.verifyOtp(buildCtx(request), request.body);
  reply.status(200).send(result);
}

export async function login(request: FastifyRequest<{ Body: AdminLoginBody }>, reply: FastifyReply) {
  const result = await service.loginWithPassword(buildCtx(request), request.body);
  reply.status(202).send(result);
}

export async function passwordForgot(request: FastifyRequest<{ Body: PasswordForgotBody }>, reply: FastifyReply) {
  const result = await service.forgotPassword(buildCtx(request), request.body.email);
  reply.status(200).send(result);
}

export async function passwordReset(request: FastifyRequest<{ Body: PasswordResetBody }>, reply: FastifyReply) {
  const result = await service.resetPassword(buildCtx(request), request.body);
  reply.status(200).send(result);
}
