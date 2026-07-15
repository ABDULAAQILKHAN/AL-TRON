import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { AxiosError } from 'axios';

/**
 * Normalizes an error raised while calling an upstream microservice (e.g. AUTH-PRO)
 * into a NestJS HttpException, preserving the upstream status/message where possible
 * instead of leaking axios internals to the client.
 */
export function normalizeUpstreamError(error: unknown, upstreamName: string): HttpException {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;

  if (axiosError?.isAxiosError) {
    if (!axiosError.response) {
      return new ServiceUnavailableException(`${upstreamName} is unreachable`);
    }

    const status = axiosError.response.status ?? HttpStatus.BAD_GATEWAY;
    const message = axiosError.response.data?.message ?? `${upstreamName} request failed`;
    return new HttpException(message, status);
  }

  return new HttpException(`Unexpected error calling ${upstreamName}`, HttpStatus.INTERNAL_SERVER_ERROR);
}
