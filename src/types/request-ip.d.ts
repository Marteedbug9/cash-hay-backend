declare module 'request-ip' {
  export function getClientIp(request: any): string | null;
  const requestIp: {
    getClientIp: typeof getClientIp;
  };
  export default requestIp;
}
