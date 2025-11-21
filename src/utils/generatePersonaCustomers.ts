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
  firstName: string;
  lastName: string;
}

interface Persona {
  id: string;
  description: string;
}

/**
 * Generate a random first and last name for a customer
 * Ensures unique names per iteration by including timestamp/random component
 */
function generateRandomName(iteration?: number): { firstName: string; lastName: string } {
  const firstNames = [
    "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn",
    "Sam", "Dakota", "Blake", "Cameron", "Drew", "Emery", "Finley", "Hayden",
    "Jamie", "Kendall", "Logan", "Parker", "Reese", "Sage", "Skylar", "Tyler",
    "Chris", "Dana", "Jesse", "Kai", "Noah", "River", "Rowan", "Sage"
  ];
  
  const lastNames = [
    "Anderson", "Brown", "Davis", "Garcia", "Harris", "Jackson", "Johnson", "Jones",
    "Lee", "Martinez", "Miller", "Moore", "Robinson", "Smith", "Taylor", "Thomas",
    "Thompson", "Walker", "White", "Williams", "Wilson", "Wright", "Young", "Adams",
    "Baker", "Clark", "Collins", "Cook", "Cooper", "Evans", "Green", "Hall"
  ];
  
  // Use iteration number or random index to select names
  // Multiply by different primes to ensure different combinations per iteration
  const randomSeed = iteration !== undefined 
    ? (iteration * 17 + Date.now() % 10000) % (firstNames.length * lastNames.length)
    : Math.floor(Math.random() * (firstNames.length * lastNames.length));
  
  const firstNameIndex = randomSeed % firstNames.length;
  const lastNameIndex = Math.floor(randomSeed / firstNames.length) % lastNames.length;
  
  // Return clean names without numeric suffix (backend may not like numbers in names)
  // The uniqueness comes from the customer_id and email, not the name
  return {
    firstName: firstNames[firstNameIndex] || "Customer",
    lastName: lastNames[lastNameIndex] || "User"
  };
}

/**
 * Generate a customer for a persona using the /customers/event endpoint
 */
async function generateCustomerForPersona(
  persona: Persona,
  dealerId: number,
  baseUrl: string,
  iteration?: number
): Promise<GenerateCustomerResponse> {
  const timestamp = new Date().toISOString();
  // Generate a random 6-digit number for the customer_id
  // Add timestamp (last 6 digits) to ensure uniqueness even if random number repeats
  const randomNumber = Math.floor(100000 + Math.random() * 900000); // 100000-999999
  const timestampSuffix = Date.now().toString().slice(-6); // Last 6 digits of timestamp
  const customerIdPrefix = `test-${randomNumber}-${timestampSuffix}`;

  // Generate unique name for this iteration
  const { firstName, lastName } = generateRandomName(iteration);
  const uniqueSuffix = Math.floor(Math.random() * 1000);

  const requestBody = {
    dealer_id: dealerId,
    customer_id: customerIdPrefix,
    timestamp: timestamp,
    customer: {
      account_type: "Person",
      customer_id: customerIdPrefix,
      person: {
        first_name: firstName,
        last_name: lastName,
        communications: [
          {
            communication_type: "PrimaryEmail",
            email_address: `${persona.id}-${iteration !== undefined ? iteration : '0'}-${uniqueSuffix}@example.com`,
          },
        ],
      },
    },
  };
  
  console.log(`[generateCustomer] Generated name: ${firstName} ${lastName} (iteration: ${iteration !== undefined ? iteration : 'N/A'})`);

  const url = `${baseUrl}/customers/event`;

  console.log(`[generateCustomer] Generating customer for persona: ${persona.id}`);
  console.log(`[generateCustomer] POST ${url}`);
  console.log(`[generateCustomer] Request body:`, JSON.stringify(requestBody, null, 2));

  try {
    const { data } = await axios.post<GenerateCustomerResponse>(url, requestBody, {
      timeout: 30000,
    });

    console.log(`[generateCustomer] ✓ Success!`);
    console.log(`[generateCustomer] Customer ID: ${data.customerId}`);
    console.log(`[generateCustomer] Conversation ID: ${data.conversationId}`);

    return {
      ...data,
      firstName,
      lastName,
    };
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
 * Update personas.ts file with generated customer name for database tracking
 */
function updatePersonasFile(
  filePath: string,
  personaUpdates: Map<string, { firstName: string; lastName: string }>
): void {
  console.log(`[updatePersonas] Reading ${filePath}...`);

  let content = readFileSync(filePath, "utf-8");

  // Update each persona's name field with generated customer name
  for (const [personaId, ids] of personaUpdates.entries()) {
    // Escape special regex characters in personaId
    const escapedPersonaId = personaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fullName = `${ids.firstName} ${ids.lastName}`;

    // Try to find and update existing name field
    // Match: id: "persona-id" ... name: "old-name" ...
    const nameRegex = new RegExp(
      `(id:\\s*"${escapedPersonaId}"[^}]*?name:\\s*")[^"]*(")`,
      "s"
    );
    if (nameRegex.test(content)) {
      content = content.replace(nameRegex, `$1${fullName}$2`);
      console.log(`[updatePersonas] Updated name to "${fullName}" for ${personaId}`);
    } else {
      // Add name field if it doesn't exist
      // Match: id: "persona-id" ... description: "..." }
      const personaWithoutNameRegex = new RegExp(
        `(id:\\s*"${escapedPersonaId}"[^}]*?description:\\s*"[^"]*")(,?)(\\s*)(\\n\\s*\\})`,
        "s"
      );

      if (personaWithoutNameRegex.test(content)) {
        content = content.replace(
          personaWithoutNameRegex,
          `$1,\n    name: "${fullName}",$4`
        );
        console.log(`[updatePersonas] Added name "${fullName}" for ${personaId}`);
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
    /id:\s*"([^"]+)",\s*description:\s*"([^"]+)"/g
  );

  const personas: Persona[] = [];
  for (const match of personaMatches) {
    const id = match[1];
    const description = match[2];
    
    // Skip if any required fields are missing
    if (!id || !description) {
      continue;
    }
    
    // Check if this persona is commented out
    const personaIndex = match.index ?? 0;
    const beforeMatch = personasContent.substring(
      Math.max(0, personaIndex - 50),
      personaIndex
    );
    if (!beforeMatch.includes("//")) {
      personas.push({ id, description });
    }
  }

  if (personas.length === 0) {
    console.error("[main] ✗ No personas found in personas.ts");
    console.error("[main] Make sure personas are not commented out");
    process.exit(1);
  }

  console.log(`[main] Found ${personas.length} persona(s) to process\n`);

  const updates = new Map<string, { customerId: string; conversationId: string; firstName: string; lastName: string }>();

  // Generate customer for each persona
  for (const persona of personas) {
    try {
      const result = await generateCustomerForPersona(persona, dealerId, baseUrl);
      updates.set(persona.id, {
        customerId: result.customerId,
        conversationId: result.conversationId,
        firstName: result.firstName,
        lastName: result.lastName,
      });

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[main] ✗ Failed to generate customer for ${persona.id}:`, error);
      console.error(`[main] Continuing with other personas...\n`);
    }
  }

  if (updates.size === 0) {
    console.error("[main] ✗ No customers were generated successfully");
    process.exit(1);
  }

  // Update personas.ts with generated customer names for database tracking
  console.log(`\n[main] Updating personas.ts with ${updates.size} customer name(s)...`);
  
  // Create a map with just firstName and lastName for name updates
  const nameUpdates = new Map<string, { firstName: string; lastName: string }>();
  for (const [personaId, ids] of updates.entries()) {
    nameUpdates.set(personaId, {
      firstName: ids.firstName,
      lastName: ids.lastName,
    });
  }
  
  updatePersonasFile(personasFilePath, nameUpdates);

  console.log("\n" + "=".repeat(70));
  console.log("COMPLETE");
  console.log("=".repeat(70));
  console.log(`Successfully generated ${updates.size} customer(s)`);
  console.log("Customer names have been updated in personas.ts for database tracking");
  console.log("Customer IDs and conversation IDs are provided by the backend API");
  console.log("=".repeat(70) + "\n");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

/**
 * Generate fresh customers for multiple personas
 * Returns a map of persona ID to customer/conversation IDs and names
 */
export async function generateFreshCustomersForPersonas(
  personas: Persona[],
  dealerId: number,
  baseUrl: string,
  iteration?: number
): Promise<Map<string, { customerId: string; conversationId: string; firstName: string; lastName: string }>> {
  const customerMap = new Map<string, { customerId: string; conversationId: string; firstName: string; lastName: string }>();
  
  for (const persona of personas) {
    try {
      // Pass iteration number to ensure unique names per iteration
      const result = await generateCustomerForPersona(persona, dealerId, baseUrl, iteration);
      customerMap.set(persona.id, {
        customerId: result.customerId,
        conversationId: result.conversationId,
        firstName: result.firstName,
        lastName: result.lastName,
      });
      
      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[generateFreshCustomersForPersonas] ✗ Failed to generate customer for ${persona.id}:`, error);
      // Continue with other personas
    }
  }
  
  return customerMap;
}

export { main, generateCustomerForPersona };

