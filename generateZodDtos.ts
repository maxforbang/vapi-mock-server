import { z } from "zod";
import { resolveRefs } from "json-refs";
import { format } from "prettier";
import jsonSchemaToZod from "json-schema-to-zod";
import path from "path";
import fs from "fs";
import { dereferenceSchema, getCachedSpec } from "./utils";

const zodObjectsDir = path.resolve(__dirname, 'zod-dtos');
const cachedApiSpecFilePath = path.resolve(__dirname, 'vapi-openapi-spec.json');
const vapiApiSpecUrl = 'https://api.vapi.ai/api-json';

async function generateZodExportFileFromJsonSchema(schemaKey: string, jsonSchema: any) {
  const { resolved } = await resolveRefs(jsonSchema);
  const code = jsonSchemaToZod(resolved);
  const formattedCode = await format(`import { z } from 'zod';\n\nexport const ${schemaKey} = ${code};`, { parser: "typescript" });

  return formattedCode;
}

(async () => {
  const openApiSpec = await getCachedSpec(cachedApiSpecFilePath, vapiApiSpecUrl);
  const dereferencedOpenApiSpec = await dereferenceSchema(openApiSpec);
  const jsonSchemas = dereferencedOpenApiSpec.components.schemas;

  if (!jsonSchemas) {
    console.error("No schemas found in OpenAPI spec");
    return;
  }

  if (!fs.existsSync(zodObjectsDir)) {
    fs.mkdirSync(zodObjectsDir);
  }

  for (const schemaKey in jsonSchemas) {
    if (jsonSchemas.hasOwnProperty(schemaKey)) {
      const schema = jsonSchemas[schemaKey];
      const zodObject = await generateZodExportFileFromJsonSchema(schemaKey, schema);
      fs.writeFileSync(path.join(zodObjectsDir, `${schemaKey}.ts`), zodObject, 'utf-8');
      console.log(`Generated Zod object for ${schemaKey}`);
    }
  }
})();
