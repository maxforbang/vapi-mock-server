import { ServerMessageStatusUpdate } from './zod-dtos/ServerMessageStatusUpdate';
// Bun Server (https://bun.sh)
// Prism client for API Mocking (https://github.com/stoplightio/prism/blob/master/docs/guides/07-http-client.md)

const fs = require('fs');
const path = require('path');
const { getHttpOperationsFromSpec } = require('@stoplight/prism-cli/dist/operations');
const { createClientFromOperations } = require('@stoplight/prism-http/dist/client');
import { JSONSchemaFaker } from 'json-schema-faker';
import { dereferenceSchema, getCachedSpec } from './utils';

const vapiWebhookServerUrl = 'http://nestjs-app:3000/vapi/webhook'; // nestjs-app is localhost according to the docker-compose.yaml (networks: blasting-engine-network)
const vapiApiSpecUrl = 'https://api.vapi.ai/api-json';
const cacheFilePath = path.resolve(__dirname, 'vapi-openapi-spec.json');
const cacheOperationsFilePath = path.resolve(__dirname, 'vapi-openapi-spec-operations.json');

(async () => {
	const openApiSpec = await getCachedSpec(cacheFilePath, vapiApiSpecUrl);
	const httpOperations = await getCachedHttpOperations(openApiSpec);

	const client = createClientFromOperations(httpOperations, {
		mock: { dynamic: false },
		validateRequest: true,
		validateResponse: true,
		checkSecurity: false,
		errors: true,
		// upstream: new URL('https://api.example.com'),
		// upstreamProxy: undefined,
		// isProxy: true,
	});

	const server = Bun.serve({
		port: 3001,
		async fetch(req) {
			// Extract method and path from the request
			const method = req.method.toLowerCase();
			const url = new URL(req.url);
			const path = url.pathname;

			let body = {};
			if (method === 'post' || method === 'put' || method === 'patch') {
				try {
					body = await req.json();
				} catch (err) {
					return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
				}
			}

			const { name, number } = body.customer;
			const { metadata } = body;

			const callDuration = generateRandomMilliseconds(100, 500);
			const endOfCallReportDelay = generateRandomMilliseconds(100, callDuration);

			const prismResponse = await client.post(path, { method }, body);

			// Extract the ServerMessageEndOfCallReport schema
			const dereferencedOpenApiSpec = await dereferenceSchema(openApiSpec);
			const serverMessageEndOfCallReportSchema = dereferencedOpenApiSpec.components.schemas.ServerMessageEndOfCallReport;
			const serverMessageEndOfCallReport = {
				...JSONSchemaFaker.generate(serverMessageEndOfCallReportSchema),
				customer: { name, number },
				metadata,
			};

			const serverMessageStatusUpdateSchema = dereferencedOpenApiSpec.components.schemas.ServerMessageStatusUpdate;
			const serverMessageStatusUpdate = {
				...JSONSchemaFaker.generate(serverMessageStatusUpdateSchema),
				status: 'ended',
				call: { metadata },
			};

			if (path === '/call') {
				const { name, number } = serverMessageEndOfCallReport.customer;
				console.log(`statusUpdate 'ended' | ${number} - ${name} | Creating mock serverMessage, waiting ${callDuration / 1000} seconds...`);
				console.log(`endOfCallReport | ${number} - ${name} | Creating mock serverMessage, waiting ${(callDuration + endOfCallReportDelay) / 1000} seconds...`);

				setTimeout(async () => {
					try {
						const response = await fetch(vapiWebhookServerUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ message: serverMessageStatusUpdate }),
						});
						console.log(`statusUpdate 'ended' | ${number} - ${name} | Sent webhook!`);
					} catch (error) {
						console.error(`statusUpdate 'ended' | ${number} - ${name} | Failed to send webhook:`, error);
					}
				}, callDuration);

				setTimeout(async () => {
					try {
						const response = await fetch(vapiWebhookServerUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ message: serverMessageEndOfCallReport }),
						});
						console.log(`endOfCallReport | ${number} - ${name} | Sent webhook!`);
					} catch (error) {
						console.error(`endOfCallReport | ${number} - ${name} | Failed to send webhook:`, error);
					}
				}, callDuration + endOfCallReportDelay);
			}

			// Return the response from Prism
			return Response.json({ ...prismResponse.data, type: 'outboundPhoneCall' });
		},
	});

	console.log(`Listening on http://localhost:${server.port} ...`);
})();

// Function to read from cache or generate http operations if it doesn't exist
async function getCachedHttpOperations(openApiSpec) {
	if (fs.existsSync(cacheOperationsFilePath)) {
		console.log('Reading cached HTTP operations...');
		const cachedOperations = fs.readFileSync(cacheOperationsFilePath, 'utf-8');
		return JSON.parse(cachedOperations);
	} else {
		console.log('HTTP operations not cached, generating...');
		const httpOperations = await getHttpOperationsFromSpec(openApiSpec);
		fs.writeFileSync(cacheOperationsFilePath, JSON.stringify(httpOperations), 'utf-8');
		return httpOperations;
	}
}

function generateRandomMilliseconds(min = 2000, max = 10000) {
	const randomMilliseconds = Math.floor(Math.random() * (max - min + 1)) + min;
	return randomMilliseconds;
}
