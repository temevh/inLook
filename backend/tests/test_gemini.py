"""gemini.verdict_card post-processing, with the model call mocked."""
import unittest
from unittest.mock import AsyncMock, patch

from app.services import gemini

FACT = {"label": "Salesforce Sales Cloud Advanced price per user", "value": "$350 per user per month", "tier": "high"}
EVIDENCE = "Advanced The CRM for sales with enhanced security. $ 395 USD/User/Month (Billed annually)"


def answer(verdict: str, evidence: str, new_value: str = "") -> AsyncMock:
    return AsyncMock(return_value={"verdict": verdict, "newValue": new_value, "evidence": evidence,
                                   "card": {"title": "Fact updated", "criticality": "high", "fact": "x"}})


class VerdictCardTest(unittest.IsolatedAsyncioTestCase):
    async def run_verdict(self, model: AsyncMock) -> dict:
        with patch.object(gemini, "_generate_json", model):
            return await gemini.verdict_card(FACT, "page")

    async def test_current_contradicted_by_its_evidence_becomes_outdated(self):
        result = await self.run_verdict(answer("current", EVIDENCE))
        self.assertEqual(result["verdict"], "outdated")
        self.assertEqual(result["newValue"], "$395 per user per month")
        self.assertEqual(result["card"]["title"], "Fact outdated")

    async def test_current_with_matching_evidence_stays_current(self):
        result = await self.run_verdict(answer("current", "Advanced: $350 USD/User/Month"))
        self.assertEqual(result["verdict"], "current")
        self.assertIsNone(result["newValue"])

    async def test_ambiguous_evidence_is_left_alone(self):
        result = await self.run_verdict(answer("current", "Core $195, Advanced $350, Max $550"))
        self.assertEqual(result["verdict"], "current")

    async def test_outdated_answer_is_kept(self):
        result = await self.run_verdict(answer("outdated", EVIDENCE, "$395 per user per month"))
        self.assertEqual(result["newValue"], "$395 per user per month")

    async def test_outdated_value_keeps_the_stored_wording(self):
        result = await self.run_verdict(answer("outdated", EVIDENCE, "$395 USD/User/Month"))
        self.assertEqual(result["newValue"], "$395 per user per month")
        self.assertIn("$350 per user per month → $395 per user per month", result["card"]["fact"])

    def test_swap_number_keeps_the_pages_thousands_separator(self):
        self.assertEqual(gemini._swap_number("$3,000 one-time", "a fee of $3,500."), "$3,500 one-time")
        self.assertEqual(gemini._swap_number("$3,000 one-time", "$3500 one-time"), "$3,500 one-time")

    def test_numbers(self):
        self.assertEqual(gemini._numbers("$1,200 or 1200, then 3.5."), ["1200", "3.5"])


if __name__ == "__main__":
    unittest.main()
