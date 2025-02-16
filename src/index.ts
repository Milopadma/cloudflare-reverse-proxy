// src/index.ts
export interface Env {
	// If you have environment variables, define them here
}

// The single framer domain that we are pointing to
// const FRAMER_HOST = 'multi-domain-1.framer.ai';
const FRAMER_HOST = 'pubkey-domain.framer.website';

// The domains that we are routing from
// FOR EXAMPLE:
// - new.pubkey.bar -> multi-domain-1.framer.ai/bar/nyc/home
// - new.pubkey.com -> multi-domain-1.framer.ai/corporate/home
// - new.pubkey.bar/dc -> multi-domain-1.framer.ai/bar/dc/home
const PROXY_HOSTS = {
	nycbar: 'pubkey.bar',
	// dcbar: 'new.pubkey.bar/dc',
	com: 'pubkey.com',
	legacyCom: 'new.pubkey.com',
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const originalHost = url.hostname;
		let targetPath = '';

		if (url.hostname === PROXY_HOSTS.nycbar) {
			console.log('DEBUG matched nycbar route');
			url.hostname = FRAMER_HOST;

			// handle special cases first
			if (url.pathname === '/') {
				targetPath = '/bar/nyc/home';
			} else if (url.pathname === '/meetups' || url.pathname.startsWith('/meetups/')) {
				targetPath = '/bar' + url.pathname; // prepend /bar to meetups
			} else if (url.pathname === '/404') {
				targetPath = '/404';
			} else {
				// allow all other paths by prepending /bar/nyc
				targetPath = '/bar/nyc' + url.pathname;
			}
		} else if (url.hostname === PROXY_HOSTS.com || url.hostname === PROXY_HOSTS.legacyCom) {
			url.hostname = FRAMER_HOST;

			// handle special cases first
			if (url.pathname === '/') {
				targetPath = '/corporate/home';
			} else if (url.pathname === '/meetups' || url.pathname.startsWith('/meetups/')) {
				targetPath = '/corporate' + url.pathname; // prepend /corporate to meetups
			} else {
				// any non-existent route goes to 404
				targetPath = '/404';
			}
		} else if (url.hostname === FRAMER_HOST) {
			return new Response('Not Found', { status: 404 });
		}

		const canonicalUrl = new URL(request.url);
		canonicalUrl.pathname = targetPath;
		url.pathname = targetPath;

		const headers = new Headers(request.headers);
		headers.set('host', url.hostname);
		headers.set('Link', `<${canonicalUrl.toString()}>; rel="canonical"`);
		headers.set('Referrer-Policy', 'no-referrer');
		headers.delete('X-Robots-Tag');
		headers.delete('robots');

		const modifiedRequest = new Request(url.toString(), {
			...request,
			headers,
		});

		const response = await fetch(modifiedRequest).catch((err) => {
			console.error('DEBUG proxy error:', err);
			return new Response('Proxy Error', { status: 500 });
		});

		// get the response body as text
		const text = await response.text();

		// replace any mentions of the main domain in the HTML
		const modifiedText = text
			.replace(new RegExp(FRAMER_HOST, 'g'), originalHost)
			// add meta tags for sharing
			.replace(
				'</head>',
				`
				<meta property="og:url" content="${canonicalUrl.toString()}" />
				<meta name="twitter:url" content="${canonicalUrl.toString()}" />
				<link rel="canonical" href="${canonicalUrl.toString()}" />
				</head>
			`
			);

		const newHeaders = new Headers(response.headers);
		newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
		newHeaders.set(
			'Content-Security-Policy',
			`
			default-src * 'unsafe-inline' 'unsafe-eval';
			frame-ancestors 'self';
			referrer no-referrer;
			block-all-mixed-content;
		`
				.replace(/\s+/g, ' ')
				.trim()
		);
		newHeaders.set('Referrer-Policy', 'no-referrer');
		newHeaders.delete('X-Robots-Tag');
		newHeaders.delete('robots');
		newHeaders.delete('Server');
		newHeaders.delete('X-Powered-By');
		newHeaders.delete('Via');

		// update content length for modified body
		newHeaders.set('Content-Length', modifiedText.length.toString());

		return new Response(modifiedText, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		});
	},
};
