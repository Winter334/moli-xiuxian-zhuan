export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export function errorResponse(error: ApiError): ErrorResponse {
  return { error: error.code, message: error.message };
}
