"""Optional personality rewrite phase (pluggable LLM).

Fáze 1: LLM rewrites user text into character's voice/style.
Fáze 2: XTTS synthesizes the rewritten text.

Pluggable backends:
  1. Ollama (local, free, ~4GB model) — best for offline
  2. Claude API (haléř/request, ~200 tokens per rewrite) — best for quality
  3. Skip (rewrite disabled) — use raw input text
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


class PersonalityRewriter:
    """Rewrite user text into character's personality."""

    def __init__(self, mode: str = "skip"):
        """
        Args:
            mode: 'ollama', 'claude', 'skip'
        """
        self.mode = mode
        if mode == "ollama":
            self._init_ollama()
        elif mode == "claude":
            self._init_claude()
        # 'skip' mode needs nothing

    def _init_ollama(self):
        """Initialize Ollama client."""
        try:
            import requests
            self.ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
            # Test connection
            requests.get(f"{self.ollama_base}/api/tags", timeout=2)
            logger.info(f"✅ Ollama connected at {self.ollama_base}")
        except Exception as e:
            logger.warning(f"❌ Ollama not reachable: {e}. Falling back to 'skip' mode.")
            self.mode = "skip"

    def _init_claude(self):
        """Initialize Claude API client."""
        try:
            import anthropic
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                logger.warning("ANTHROPIC_API_KEY not set. Falling back to 'skip' mode.")
                self.mode = "skip"
                return
            self.client = anthropic.Anthropic(api_key=api_key)
            logger.info("✅ Claude API ready")
        except Exception as e:
            logger.warning(f"❌ Claude API init failed: {e}. Falling back to 'skip' mode.")
            self.mode = "skip"

    async def rewrite(
        self,
        text: str,
        character: str,
        system_prompt: str,
    ) -> str:
        """Rewrite text into character's voice.

        Args:
            text: User input
            character: Character name (for logging)
            system_prompt: Character's personality instructions

        Returns:
            Rewritten text in character's voice (or original if mode='skip')
        """

        if self.mode == "skip":
            return text

        if self.mode == "ollama":
            return await self._rewrite_ollama(text, character, system_prompt)

        if self.mode == "claude":
            return await self._rewrite_claude(text, character, system_prompt)

        return text

    async def _rewrite_ollama(self, text: str, character: str, system_prompt: str) -> str:
        """Rewrite using local Ollama."""
        try:
            import requests

            payload = {
                "model": "mistral",  # or whatever model available locally
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Rewrite this in your voice: {text}"},
                ],
                "stream": False,
            }

            response = requests.post(
                f"{self.ollama_base}/api/chat",
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            result = response.json()

            rewritten = result["message"]["content"].strip()
            logger.info(f"🎭 {character} (Ollama): '{text[:40]}' → '{rewritten[:40]}'")
            return rewritten

        except Exception as e:
            logger.warning(f"Ollama rewrite failed: {e}. Using original text.")
            return text

    async def _rewrite_claude(self, text: str, character: str, system_prompt: str) -> str:
        """Rewrite using Claude API."""
        try:
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=300,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Rewrite this in your voice: {text}",
                    }
                ],
            )

            rewritten = message.content[0].text.strip()
            logger.info(f"🎭 {character} (Claude): '{text[:40]}' → '{rewritten[:40]}'")
            return rewritten

        except Exception as e:
            logger.warning(f"Claude rewrite failed: {e}. Using original text.")
            return text


def detect_backend() -> str:
    """Auto-detect which rewrite backend to use.

    Priority:
      1. ANTHROPIC_API_KEY set → claude
      2. Ollama running → ollama
      3. Default → skip
    """

    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude"

    try:
        import requests
        ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        requests.get(f"{ollama_base}/api/tags", timeout=2)
        return "ollama"
    except:
        pass

    return "skip"


# Global rewriter instance (initialized at startup)
_rewriter: Optional[PersonalityRewriter] = None


def get_rewriter() -> PersonalityRewriter:
    """Get or create personality rewriter (singleton)."""
    global _rewriter
    if _rewriter is None:
        backend = detect_backend()
        logger.info(f"📝 Personality rewrite mode: {backend}")
        _rewriter = PersonalityRewriter(mode=backend)
    return _rewriter
