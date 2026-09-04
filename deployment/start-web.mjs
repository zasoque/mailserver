process.env.NODE_ENV = 'production';
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '8788';
process.env.MAIL_HELPER_PORT ??= '8787';

if (process.env.HOST !== '127.0.0.1') {
	throw new Error('The Mail Admin web server may only bind to 127.0.0.1.');
}

await import('../build/index.js');
