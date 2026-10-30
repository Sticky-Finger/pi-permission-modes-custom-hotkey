import { describe, expect, it } from "vitest";

import {
	buildFeedbackDenialReason,
	buildFeedbackOptionLabel,
	buildFeedbackPromptTitle,
	FEEDBACK_OPTION_LABEL,
	MAX_FEEDBACK_CHARS,
	sanitizeFeedback,
} from "./permission-feedback.ts";

describe("permission-feedback: option label", () => {
	it("uses the default label when no target is given", () => {
		expect(buildFeedbackOptionLabel()).toBe(
			"No, and tell the agent what to do differently",
		);
		expect(buildFeedbackOptionLabel("")).toBe(FEEDBACK_OPTION_LABEL);
		expect(buildFeedbackOptionLabel("   ")).toBe(FEEDBACK_OPTION_LABEL);
	});

	it("substitutes the target name", () => {
		expect(buildFeedbackOptionLabel("scout")).toBe(
			"No, and tell scout what to do differently",
		);
		expect(buildFeedbackOptionLabel("  scout  ")).toBe(
			"No, and tell scout what to do differently",
		);
	});
});

describe("permission-feedback: prompt title", () => {
	it("mentions the agent and the tool by default", () => {
		expect(buildFeedbackPromptTitle("bash")).toBe(
			"Tell the agent how to proceed with bash:",
		);
	});

	it("mentions the named target when given", () => {
		expect(buildFeedbackPromptTitle("bash", "scout")).toBe(
			"Tell scout how to proceed with bash:",
		);
		expect(buildFeedbackPromptTitle("bash", "  ")).toBe(
			"Tell the agent how to proceed with bash:",
		);
	});
});

describe("permission-feedback: sanitizeFeedback", () => {
	it("returns empty string for missing input", () => {
		expect(sanitizeFeedback(undefined)).toBe("");
		expect(sanitizeFeedback(null)).toBe("");
		expect(sanitizeFeedback("")).toBe("");
	});

	it("collapses whitespace runs and trims", () => {
		expect(sanitizeFeedback("  hello   world  ")).toBe("hello world");
		expect(sanitizeFeedback("line1\n\n\tline2")).toBe("line1 line2");
		expect(sanitizeFeedback("多行\n反馈")).toBe("多行 反馈");
	});

	it("caps the length", () => {
		const long = "a".repeat(MAX_FEEDBACK_CHARS + 500);
		const out = sanitizeFeedback(long);
		expect(out.length).toBe(MAX_FEEDBACK_CHARS);
	});

	it("keeps text at the cap unchanged", () => {
		const exact = "b".repeat(MAX_FEEDBACK_CHARS);
		expect(sanitizeFeedback(exact)).toBe(exact);
	});
});

describe("permission-feedback: denial reason", () => {
	it("appends the feedback to the base reason", () => {
		expect(
			buildFeedbackDenialReason("bash blocked by user", "read the VERSION file"),
		).toBe("bash blocked by user. User feedback: read the VERSION file");
	});

	it("keeps the base reason when feedback is empty or missing", () => {
		expect(buildFeedbackDenialReason("bash blocked by user", "")).toBe(
			"bash blocked by user",
		);
		expect(buildFeedbackDenialReason("bash blocked by user", undefined)).toBe(
			"bash blocked by user",
		);
		expect(buildFeedbackDenialReason("bash blocked by user", "   ")).toBe(
			"bash blocked by user",
		);
	});

	it("sanitizes the feedback before appending it", () => {
		expect(
			buildFeedbackDenialReason("bash blocked by user", "  do   this \n instead "),
		).toBe("bash blocked by user. User feedback: do this instead");
	});
});
