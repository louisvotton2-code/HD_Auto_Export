export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string,
    public fields?: Array<{path:string;code:string;message:string}>, public retryable = false) { super(message); }
}
export const conflict = () => new ApiError(409, 'VERSION_CONFLICT', 'Reload the current version before saving.');
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource is not available.');
