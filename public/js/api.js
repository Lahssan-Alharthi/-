/* طبقة الاتصال بواجهة الخادم */
(function attachApi(global) {
  'use strict';

  async function request(method, path, body, options) {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: {},
      ...(options || {}),
    };

    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const response = await fetch(`/api${path}`, opts);

    if (response.status === 401 && !path.startsWith('/auth/')) {
      global.dispatchEvent(new CustomEvent('session-expired'));
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!response.ok) throw new Error('تعذّر تنفيذ الطلب');
      return response;
    }

    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || 'تعذّر تنفيذ الطلب');
      error.status = response.status;
      error.details = payload.details;
      throw error;
    }
    return payload;
  }

  const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),

    /** يبني سلسلة استعلام من كائن، متجاهلاً القيم الفارغة. */
    qs(params) {
      const search = new URLSearchParams();
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.append(key, value);
      });
      const text = search.toString();
      return text ? `?${text}` : '';
    },

    /** يفتح رابط تنزيل مباشر. */
    download(path) {
      global.open(`/api${path}`, '_blank');
    },
  };

  global.api = api;
}(window));
