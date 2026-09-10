export const APP_NAME = 'Overdue Checklist Items';

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export async function prepareAuth(sdk, appKey) {
  if (!appKey) throw new AuthError('setup');
  if (!sdk) throw new AuthError('sdk');
  let client;
  try {
    const t = sdk.iframe({ appKey, appName: APP_NAME });
    client = await t.getRestApi();
  } catch { throw new AuthError('storage'); }
  return {
    async getToken() {
      try { return await client.getToken(); }
      catch { throw new AuthError('storage'); }
    },
    // Do not await anything before this call: preserve the click's user activation.
    authorize() {
      try {
        return Promise.resolve(client.authorize({ scope: 'read', expiration: 'never' }))
          .catch(error => { throw classify(error); });
      } catch (error) { return Promise.reject(classify(error)); }
    },
    async clearToken() {
      try { await client.clearToken(); }
      catch { throw new AuthError('storage'); }
    },
  };
}

function classify(error) {
  if (error?.name === 'AuthDeniedError') return new AuthError('denied');
  if (error?.name === 'AuthCancelledError' || error?.name === 'AuthCanceledError') {
    return new AuthError('cancelled');
  }
  return new AuthError('consent');
}
