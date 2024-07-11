const fs = require('fs');
const RefParser = require('json-schema-ref-parser');

// Function to read from cache or fetch the spec if it doesn't exist
export async function getCachedSpec(cacheFilePath, apiSpecUrl) {
	if (fs.existsSync(cacheFilePath)) {
		console.log('Reading cached OpenAPI spec...');
		const cachedSpec = fs.readFileSync(cacheFilePath, 'utf-8');
		return JSON.parse(cachedSpec);
	} else {
		console.log('OpenAPI spec not cached, fetching...');
		const response = await fetch(apiSpecUrl);
		const openApiSpec = await response.json();
		fs.writeFileSync(cacheFilePath, JSON.stringify(openApiSpec), 'utf-8');
		return openApiSpec;
	}
}

export async function dereferenceSchema(schema) {
	try {
		// This will replace all `$ref` with actual parts of the schema
		return await RefParser.dereference(schema);
	} catch (error) {
		console.error('Failed to dereference schema:', error);
		throw error;
	}
}