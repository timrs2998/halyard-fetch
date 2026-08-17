/** Source `id` generation — see `types.ts`'s doc comment on `Source.id`. */

export function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "source";
}

function randomSuffix(length = 6): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = new Uint8Array(length);
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
		cryptoObj.getRandomValues(bytes);
	} else {
		for (let i = 0; i < length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	let out = "";
	for (let i = 0; i < length; i++) {
		out += alphabet[bytes[i] % alphabet.length];
	}
	return out;
}

/** `displayName` slugified plus a short random suffix — see `types.ts`. */
export function generateSourceId(displayName: string): string {
	return `${slugify(displayName)}-${randomSuffix()}`;
}
