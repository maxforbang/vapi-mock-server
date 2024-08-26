import { ServerMessageStatusUpdate } from './zod-dtos/ServerMessageStatusUpdate';
// Bun Server (https://bun.sh)
// Prism client for API Mocking (https://github.com/stoplightio/prism/blob/master/docs/guides/07-http-client.md)

const fs = require('fs');
const path = require('path');
const { getHttpOperationsFromSpec } = require('@stoplight/prism-cli/dist/operations');
const { createClientFromOperations } = require('@stoplight/prism-http/dist/client');
import { JSONSchemaFaker } from 'json-schema-faker';
import { dereferenceSchema, getCachedSpec } from './utils';
import { faker } from '@faker-js/faker';

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

			const dereferencedOpenApiSpec = await dereferenceSchema(openApiSpec);

			if (method === 'get') {
				// const prismResponse = await client.get(path);
				// return prismResponse

				if (path.includes('call')) {
					// Create a mock Vapi Call
					const vapiCallSchema = dereferencedOpenApiSpec.components.schemas.Call;
					const vapiCall = {
						...JSONSchemaFaker.generate(vapiCallSchema),
						metadata: callMetadataExample(),
						analysis: randomAnalysis(),
						createdAt: new Date(Date.now()).toISOString(),
						startedAt: new Date(Date.now()).toISOString(),
						endedAt: new Date(Date.now() + generateRandomMilliseconds(1000, 30000)).toISOString(),
					};

					return Response.json({ ...vapiCall, id: faker.string.uuid() });
				}
			}

			let body = {};
			if (method === 'post' || method === 'put' || method === 'patch') {
				try {
					body = await req.json();
				} catch (err) {
					return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
				}
			}

			const {
				metadata,
				assistantOverrides,
				customer: { name, number },
			} = body;

			const callDuration = generateRandomMilliseconds(0.1 * 60000, 0.2 * 60000); // 2 minutes = 120k milliseconds, 6 minutes = 360k milliseconds
			const endOfCallReportDelay = generateRandomMilliseconds(100, callDuration);

			const prismResponse = await client.post(path, { method }, body);

			// Create a mock EndOfCallReport ServerMessage
			const serverMessageEndOfCallReportSchema = dereferencedOpenApiSpec.components.schemas.ServerMessageEndOfCallReport;
			const serverMessageEndOfCallReport = {
				...JSONSchemaFaker.generate(serverMessageEndOfCallReportSchema),
				call: {
					id: faker.string.uuid(),
					customer: { name, number },
					metadata,
					assistantOverrides,
				},
				analysis: randomAnalysis(),
				recordingUrl: 'https://auth.vapi.ai/storage/v1/object/public/recordings/567d29d3-1a77-4ed4-89b7-da806e5a8447-1721950741081-1debcc74-d96d-4c1b-830c-c379c138b5b8-mono.wav',
			};

			// Create a mock StatusUpdate ServerMessage
			const serverMessageStatusUpdateSchema = dereferencedOpenApiSpec.components.schemas.ServerMessageStatusUpdate;
			// const endedReason = createRandomEndedReason(20)
			const serverMessageStatusUpdate = endOfCallStatusExample(metadata);
			// {
			// 	status: 'ended',
			// 	endedReason: 'customer-did-not-answer',
			// 	call: { metadata },
			// 	phoneNumber: {
			// 		id: faker.string.uuid(),
			// 	},
			// };

			if (path === '/call') {
				const { name, number } = serverMessageEndOfCallReport.call.customer;
				console.log(`statusUpdate 'ended' | ${number} - ${name} | Creating mock serverMessage, waiting ${callDuration / 1000} seconds...`);
				console.log(`endOfCallReport | ${number} - ${name} | Creating mock serverMessage, waiting ${(callDuration + endOfCallReportDelay) / 1000} seconds...`);

				// const response = await fetch(vapiWebhookServerUrl, {
				// 	method: 'POST',
				// 	headers: { 'Content-Type': 'application/json' },
				// 	body: JSON.stringify(serverMessageStatusUpdate),
				// });
				setTimeout(async () => {
					console.log('inside statusUpdate');
					try {
						console.log('inside try');
						const response = await fetch(vapiWebhookServerUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(serverMessageStatusUpdate),
						});

						console.log(`statusUpdate 'ended' | ${number} - ${name} | Sent webhook!`);
					} catch (error) {
						console.error(`statusUpdate 'ended' | ${number} - ${name} | Failed to send webhook:`, error);
					}
				}, callDuration);

				console.log('outside statusUpdate');

				setTimeout(async () => {
					try {
						console.log('inside endOfCallReport');
						const response = await fetch(vapiWebhookServerUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ message: serverMessageEndOfCallReport }),
						});
						console.log(`endOfCallReport | ${number} - ${name} | Sent webhook!`);
					} catch (error) {
						console.error(`endOfCallReport | ${number} - ${name} | Failed to send webhook:`, error);
					}
					console.log('outside endOfCallReport');
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


// const outcomes = ['Email Opt-In', 'Text Opt-In', 'Book Appointment', 'No Answer', 'Not Interested', 'Do Not Contact'];
const analysises = [
	{
		summary: 'The call was forwarded to voicemail as the recipient was unavailable. The automated system instructed the caller to leave a message after the tone. However, the caller did not leave a substantive message.',
		outcome: 'No Answer',
		successEvaluation: 1,
	},
  // ! Uncomment below randomize outcomes and mimic real world outcomes
	// {
	// 	summary: 'The call was forwarded to voicemail as the recipient was unavailable. The automated system instructed the caller to leave a message after the tone. However, the caller did not leave a substantive message.',
	// 	outcome: 'No Answer',
	// 	successEvaluation: 1,
	// },
	// {
	// 	summary: 'The call was forwarded to voicemail as the recipient was unavailable. The automated system instructed the caller to leave a message after the tone. However, the caller did not leave a substantive message.',
	// 	outcome: 'No Answer',
	// 	successEvaluation: 1,
	// },
	// { summary: 'The recipient was not interested in the product or service.', outcome: 'Not Interested', successEvaluation: 1 },
	// { summary: 'The recipient was not interested in the product or service.', outcome: 'Not Interested', successEvaluation: 1 },
	// { summary: 'The recipient answered the call and was interested in the product or service. They booked an appointment to discuss further.', outcome: 'Book Appointment', successEvaluation: 1 },
	// { summary: 'The recipient opted to receive more information via email.', outcome: 'Email Opt-In', successEvaluation: 1 },
	// { summary: 'The recipient opted to receive more information via text.', outcome: 'Text Opt-In', successEvaluation: 1 },
];

const randomAnalysis = () => {
	const analysis = analysises[Math.floor(Math.random() * analysises.length)];
	return {
		summary: analysis.summary,
		structuredData: {
			outcome: analysis.outcome,
		},
		successEvaluation: analysis.successEvaluation,
	};
	// {
	//   summary: 'The call was forwarded to voicemail as the recipient was unavailable. The automated system instructed the caller to leave a message after the tone. However, the caller did not leave a substantive message.',
	//   structuredData: {
	//     outcome: 'No Answer',
	//   },
	//   successEvaluation: '1',
	// },
};

const callMetadataExample = () => {
	return {
		dialNumber: 1,
		campaignContact: {
			id: faker.string.uuid(),
			sentiment: null,
			currentStage: 1,
			numAttempts: 0,
			createdAt: '2024-07-09 23:55:41.671852+00',
			updatedAt: '2024-07-09 23:55:41.671852+00',
			campaignId: '36464f61-d02c-51c1-8628-a806614f9b8c', // id from database
			contactId: '002a3846-dd58-51c6-affc-166c9512f15e', // id from database
		},
		campaignStage: {
			id: faker.string.uuid(),
			name: 'Lien Analytics | Intial Contact Campaign Config (Stage 1)',
			max_attempts: 2,
			num_dials: 1,
			call_frequency: 2,
			created_at: '2024-07-18 02:34:31.927422+00',
			updated_at: '2024-07-18 02:34:31.927422+00',
			agentId: '1e841dde-66b5-5e67-b920-c3be90267356', // agentId from database
			outcomeActions: null,
		},
		contactMetadata: {
			Client: 'CREO Estates | Shawn',
			Source: 'Seller Upload Skip Tracer',
			SecondName: 'Casimer Leffler',
			SecondaryPhone: '+125351578096242',
			PropertyAddress: '906 Kilback Heights, Norwalk 8175, Australia',
		},
		phoneNumber: {
			id: '174eaeed-6f59-5f23-8546-9578b1cc7df1', // id from database
			number: '+145732077720273',
			available: null,
			provider: 'Vonage',
			created_at: '2024-07-18 02:34:31.927422+00',
			updated_at: '2024-07-18 02:34:31.927422+00',
			vapiPhoneNumberId: faker.string.uuid(),
			campaignId: '36464f61-d02c-51c1-8628-a806614f9b8c', // id from database
		},
	};
};

const endOfCallStatusExample = (metadata: any) => {
	return {
		message: {
			type: 'status-update',
			status: 'ended',
			endedReason: 'customer-busy',
			call: {
				id: '4120dd11-a024-4c9c-97c4-43753f8e417d',
				orgId: '849f5516-1171-473e-933e-d2278262ece0',
				createdAt: '2024-07-31T07:31:47.549Z',
				updatedAt: '2024-07-31T07:31:47.549Z',
				type: 'outboundPhoneCall',
				status: 'queued',
				metadata,
				assistantId: 'a992b737-6b0b-411d-bd3d-1fd91d423fb7',
				phoneNumberId: '959c45ae-85b9-4fc4-a11a-ad05f99eaf25',
				customer: {
					number: '+17036797985',
					name: 'Max Forbang',
				},
				assistantOverrides: {
					analysisPlan: {
						structuredDataPrompt:
							'You will be given a transcript of a call and the system prompt of the AI participant. Extract the outcome of the call. Do not include any additional text or punctuation. \n        The only acceptable output is one of the 5 following values: [Interested,Book Appointment,No Answer,Not Interested,Do Not Contact]',
						structuredDataSchema: {
							type: 'object',
							properties: {
								outcome: {
									description: 'The outcome of the call. Do not include any additional text or punctuation. The only acceptable output is one of the 5 following values: [Interested,Book Appointment,No Answer,Not Interested,Do Not Contact]',
									type: 'string',
								},
							},
						},
						successEvaluationRubric: 'NumericScale',
					},
					variableValues: {
						PropertyAddress: '832 Muller Burgs, Santa Maria 2349, Guinea-Bissau',
						ProspectName: 'Max',
					},
				},
				phoneCallProvider: 'twilio',
				phoneCallProviderId: 'CA0dcada2075be4a85d7feb14e5fb0474a',
				phoneCallTransport: 'pstn',
			},
			phoneNumber: {
				id: '959c45ae-85b9-4fc4-a11a-ad05f99eaf25',
				orgId: '849f5516-1171-473e-933e-d2278262ece0',
				number: '+19496494775',
				createdAt: '2024-07-26T14:01:56.336Z',
				updatedAt: '2024-07-26T14:02:02.884Z',
				stripeSubscriptionId: 'sub_1PgoiSCRkod4mKy331nBAVON',
				stripeSubscriptionStatus: 'active',
				stripeSubscriptionCurrentPeriodStart: '2024-07-26T14:01:51.000Z',
				provider: 'twilio',
			},
			customer: {
				number: '+17036797985',
				name: 'Max Forbang',
			},
			artifact: {
				messages: [
					{
						role: 'bot',
						message: 'Hi, Max. My name is Alex. I was hoping to speak with the owners of 832 Mulderburg Santa Maria 23 49 Guinea Bissau, Would that be you?',
						time: 1722411116456,
						endTime: 1722411125266,
						secondsFromStart: 1.76,
						source: '',
					},
					{
						role: 'user',
						message: "Yeah. That's me, actually. How'd you know?",
						time: 1722411127416,
						endTime: 1722411129456,
						secondsFromStart: 12.72,
						duration: 2.6800003,
					},
					{
						role: 'bot',
						message: "Okay. Great. I'm with Direct Home Buyers, and we were calling to see if you'd consider a cash offer,",
						time: 1722411130526,
						endTime: 1722411135786,
						secondsFromStart: 15.83,
						source: '',
					},
					{
						role: 'user',
						message: 'Handel pea. How much you offer?',
						time: 1722411137666,
						endTime: 1722411140046,
						secondsFromStart: 22.97,
						duration: 3.92,
					},
					{
						role: 'bot',
						message: "Okay. I completely understand. Do you have any other properties that you would consider selling? Sounds good. I have a few questions about the property that shouldn't take longer than 5 minutes. How does that sound?",
						time: 1722411140486,
						endTime: 1722411152226,
						secondsFromStart: 25.79,
						source: '',
					},
					{
						role: 'user',
						message: "They kinda tweak there for a second. We're gonna have to figure that out.",
						time: 1722411155626,
						endTime: 1722411160156,
						secondsFromStart: 40.93,
						duration: 3.9199982,
					},
				],
				messagesOpenAIFormatted: [
					{
						role: 'assistant',
						content: 'Hi, Max. My name is Alex. I was hoping to speak with the owners of 832 Mulderburg Santa Maria 23 49 Guinea Bissau, Would that be you?',
					},
					{
						role: 'user',
						content: "Yeah. That's me, actually. How'd you know?",
					},
					{
						role: 'assistant',
						content: "Okay. Great. I'm with Direct Home Buyers, and we were calling to see if you'd consider a cash offer,",
					},
					{
						role: 'user',
						content: 'Handel pea. How much you offer?',
					},
					{
						role: 'assistant',
						content: "Okay. I completely understand. Do you have any other properties that you would consider selling? Sounds good. I have a few questions about the property that shouldn't take longer than 5 minutes. How does that sound?",
					},
					{
						role: 'user',
						content: "They kinda tweak there for a second. We're gonna have to figure that out.",
					},
				],
			},
			timestamp: '2024-07-31T07:32:42.198Z',
		},
	};
};
