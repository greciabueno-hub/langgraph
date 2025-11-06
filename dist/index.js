import "dotenv/config";
import app from "./graph.js";
import { HumanMessage } from "@langchain/core/messages";
async function main() {
    const input = {
        messages: [
            new HumanMessage("Hi, I'm looking for a compact SUV under $30k with good fuel economy."),
        ],
    };
    const result = await app.invoke(input);
    // Print the full conversation so you can see both agents alternating
    for (const msg of result.messages) {
        const role = msg.type;
        console.log(`[${role}]`, msg.content);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map