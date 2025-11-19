// generatePersonaCustomers.ts
// Script to generate customers for each persona and update personas.ts with customerId and conversationId
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

interface GenerateCustomerResponse {
  success: boolean;
  customerId: string;
  conversationId: string;
}

interface Persona {
  id: string;
  name: string;
  description: string;
  customerId?: string;
  conversationId?: string;
}

/**
 * Generate a customer for a persona using the /customers/event endpoint
 */
async function generateCustomerForPersona(
  persona: Persona,
  dealerId: number,
  baseUrl: string
): Promise<GenerateCustomerResponse> {
  const timestamp = new Date().toISOString();
  // Generate a random 6-digit number for the customer_id
  // Add timestamp (last 6 digits) to ensure uniqueness even if random number repeats
  const randomNumber = Math.floor(100000 + Math.random() * 900000); // 100000-999999
  const timestampSuffix = Date.now().toString().slice(-6); // Last 6 digits of timestamp
  const customerIdPrefix = `eval-${randomNumber}-${timestampSuffix}`;

  const requestBody = {
    dealer_id: dealerId,
    customer_id: customerIdPrefix,
    timestamp: timestamp,
    customer: {
      account_type: "Person",
      customer_id: customerIdPrefix,
      person: {
        first_name: persona.name.split(" ")[0] || "Customer",
        last_name: persona.name.split(" ").slice(1).join(" ") || persona.id,
        communications: [
          {
            communication_type: "PrimaryEmail",
            email_address: `${persona.id}@example.com`,
          },
        ],
      },
    },
  };

  const url = `${baseUrl}/customers/event`;

  console.log(`[generateCustomer] Generating customer for persona: ${persona.name}`);
  console.log(`[generateCustomer] POST ${url}`);
  console.log(`[generateCustomer] Request body:`, JSON.stringify(requestBody, null, 2));

  try {
    const { data } = await axios.post<GenerateCustomerResponse>(url, requestBody, {
      timeout: 30000,
    });

    console.log(`[generateCustomer] ✓ Success!`);
    console.log(`[generateCustomer] Customer ID: ${data.customerId}`);
    console.log(`[generateCustomer] Conversation ID: ${data.conversationId}`);

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[generateCustomer] ✗ Error:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        message: error.message,
      });
    } else {
      console.error(`[generateCustomer] ✗ Unexpected error:`, error);
    }
    throw error;
  }
}

/**
 * Update personas.ts file with new customerId and conversationId
 */
function updatePersonasFile(
  filePath: string,
  personaUpdates: Map<string, { customerId: string; conversationId: string }>
): void {
  console.log(`[updatePersonas] Reading ${filePath}...`);

  let content = readFileSync(filePath, "utf-8");

  // Update each persona's customerId and conversationId
  for (const [personaId, ids] of personaUpdates.entries()) {
    // Escape special regex characters in personaId
    const escapedPersonaId = personaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Pattern to find the persona object: id: "persona-id", ... { ... customerId: "...", conversationId: "..." }
    // We'll look for the persona block and update both IDs
    
    // First, try to find and update existing customerId and conversationId
    // Match: id: "persona-id" ... customerId: "old-id" ... conversationId: "old-conv-id"
    // Capture groups: $1 = before customerId, $2 = customerId line, $3 = between, $4 = conversationId line
    const personaBlockRegex = new RegExp(
      `(id:\\s*"${escapedPersonaId}"[^}]*?)(customerId:\\s*"[^"]*",?\\s*)([^}]*?)(conversationId:\\s*"[^"]*",?)`,
      "s"
    );

    if (personaBlockRegex.test(content)) {
      // Replace both customerId and conversationId, ensuring proper comma placement and newline
      content = content.replace(
        personaBlockRegex,
        `$1customerId: "${ids.customerId}", \n    conversationId: "${ids.conversationId}",`
      );
      console.log(`[updatePersonas] Updated customerId and conversationId for ${personaId}`);
    } else {
      // Try to find persona without customerId/conversationId and add them
      // Match: id: "persona-id" ... description: "..." }
      const personaWithoutIdsRegex = new RegExp(
        `(id:\\s*"${escapedPersonaId}"[^}]*?description:\\s*"[^"]*")(,?)(\\s*)(\\n\\s*\\})`,
        "s"
      );

      if (personaWithoutIdsRegex.test(content)) {
        content = content.replace(
          personaWithoutIdsRegex,
          `$1,$3customerId: "${ids.customerId}",$3conversationId: "${ids.conversationId}",$4`
        );
        console.log(`[updatePersonas] Added customerId and conversationId for ${personaId}`);
      } else {
        // Try simpler approach: just find customerId and conversationId separately
        // Match customerId with optional trailing comma
        const customerIdOnlyRegex = new RegExp(
          `(id:\\s*"${escapedPersonaId}"[^}]*?customerId:\\s*")[^"]*(")(,?\\s*)`,
          "s"
        );
        // Match conversationId with optional trailing comma
        const conversationIdOnlyRegex = new RegExp(
          `(id:\\s*"${escapedPersonaId}"[^}]*?conversationId:\\s*")[^"]*(")(,?\\s*)`,
          "s"
        );

        if (customerIdOnlyRegex.test(content)) {
          content = content.replace(customerIdOnlyRegex, `$1${ids.customerId}$2, `);
          console.log(`[updatePersonas] Updated customerId for ${personaId}`);
        }
        if (conversationIdOnlyRegex.test(content)) {
          content = content.replace(conversationIdOnlyRegex, `$1${ids.conversationId}$2,`);
          console.log(`[updatePersonas] Updated conversationId for ${personaId}`);
        }
      }
    }
  }

  // Write updated content back to file
  writeFileSync(filePath, content, "utf-8");
  console.log(`[updatePersonas] ✓ Updated ${filePath}`);
}

/**
 * Main function to generate customers for all personas
 */
async function main() {
  const baseUrl =
    process.env.AUTOMOTIVE_API_BASE_URL || "http://localhost:5000";
  const dealerId = Number(process.env.DEALERSHIP_ID || "4675");
  const personasFilePath = join(process.cwd(), "src", "personas.ts");

  console.log("\n" + "=".repeat(70));
  console.log("GENERATE CUSTOMERS FOR PERSONAS");
  console.log("=".repeat(70));
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Dealership ID: ${dealerId}`);
  console.log(`Personas file: ${personasFilePath}`);
  console.log("=".repeat(70) + "\n");

  // Read personas.ts to get the personas
  console.log("[main] Reading personas.ts...");
  const personasContent = readFileSync(personasFilePath, "utf-8");

  // Extract personas from the file (simple regex-based extraction)
  // This is a simplified approach - in production you might want to use a TypeScript parser
  const personaMatches = personasContent.matchAll(
    /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)"/g
  );

  const personas: Persona[] = [];
  for (const match of personaMatches) {
    const id = match[1];
    const name = match[2];
    const description = match[3];
    
    // Skip if any required fields are missing
    if (!id || !name || !description) {
      continue;
    }
    
    // Check if this persona is commented out
    const personaIndex = match.index ?? 0;
    const beforeMatch = personasContent.substring(
      Math.max(0, personaIndex - 50),
      personaIndex
    );
    if (!beforeMatch.includes("//")) {
      personas.push({ id, name, description });
    }
  }

  if (personas.length === 0) {
    console.error("[main] ✗ No personas found in personas.ts");
    console.error("[main] Make sure personas are not commented out");
    process.exit(1);
  }

  console.log(`[main] Found ${personas.length} persona(s) to process\n`);

  const updates = new Map<string, { customerId: string; conversationId: string }>();

  // Generate customer for each persona
  for (const persona of personas) {
    try {
      const result = await generateCustomerForPersona(persona, dealerId, baseUrl);
      updates.set(persona.id, {
        customerId: result.customerId,
        conversationId: result.conversationId,
      });

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[main] ✗ Failed to generate customer for ${persona.name}:`, error);
      console.error(`[main] Continuing with other personas...\n`);
    }
  }

  if (updates.size === 0) {
    console.error("[main] ✗ No customers were generated successfully");
    process.exit(1);
  }

  // Update personas.ts file
  console.log(`\n[main] Updating personas.ts with ${updates.size} customer ID(s)...`);
  updatePersonasFile(personasFilePath, updates);

  console.log("\n" + "=".repeat(70));
  console.log("COMPLETE");
  console.log("=".repeat(70));
  console.log(`Successfully generated ${updates.size} customer(s)`);
  console.log("personas.ts has been updated with new customerId and conversationId");
  console.log("=".repeat(70) + "\n");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { main };

