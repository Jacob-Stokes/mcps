// zod → JSON Schema converter, tuned for MCP tool input_schema semantics.
//
// Anthropic's tool input_schema format does NOT support oneOf/anyOf/allOf at
// the top level. Discriminated unions (common for multi-action tools) flatten
// into a single object with the discriminator as a required enum and all
// other fields optional. Runtime zod validation still enforces correct
// action→field combinations, so type safety is preserved.

import type { z } from "zod";

export function zodToJsonSchema(schema: z.ZodType): any {
  const def: any = (schema as any)._def;

  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJsonSchema(v as z.ZodType);
      if (!(v as any).isOptional?.() && !isDefaulted(v as z.ZodType)) required.push(k);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }

  if (def.typeName === "ZodDiscriminatedUnion") {
    const discriminator: string = def.discriminator;
    const discriminatorValues: string[] = [];
    const allProperties: Record<string, any> = {};
    for (const opt of def.options as z.ZodObject<any>[]) {
      const shape = ((opt as any)._def.shape)();
      for (const [k, v] of Object.entries(shape)) {
        if (k === discriminator) {
          const litDef = (v as any)._def;
          if (litDef?.typeName === "ZodLiteral") discriminatorValues.push(litDef.value);
          continue;
        }
        if (!(k in allProperties)) {
          allProperties[k] = zodToJsonSchema(v as z.ZodType);
        }
      }
    }
    allProperties[discriminator] = {
      type: "string",
      enum: discriminatorValues,
      description:
        "Which operation to perform. Other fields are required/optional depending on the value chosen — see tool description.",
    };
    return {
      type: "object",
      properties: allProperties,
      required: [discriminator],
      additionalProperties: false,
    };
  }

  if (def.typeName === "ZodUnion") return zodToJsonSchema(def.options[0]);
  if (def.typeName === "ZodArray") return { type: "array", items: zodToJsonSchema(def.type) };
  if (def.typeName === "ZodEnum") return { type: "string", enum: def.values };
  if (def.typeName === "ZodLiteral") return { const: def.value };

  if (def.typeName === "ZodString") {
    const s: any = { type: "string" };
    if (def.description) s.description = def.description;
    return s;
  }
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodOptional") return zodToJsonSchema(def.innerType);
  if (def.typeName === "ZodNullable") return { ...zodToJsonSchema(def.innerType), nullable: true };
  if (def.typeName === "ZodDefault") {
    const inner = zodToJsonSchema(def.innerType);
    inner.default = def.defaultValue();
    return inner;
  }

  return {};
}

export function isDefaulted(v: z.ZodType): boolean {
  return (v as any)._def?.typeName === "ZodDefault" || (v as any)._def?.typeName === "ZodOptional";
}
