class ExtractorProvider {
  async extract({
    userMessage,
    turnContext = null,
    correctionCandidates = [],
  }) {
    throw new Error("extract() must be implemented by an extractor provider");
  }

  async repair({
    userMessage,
    turnContext = null,
    correctionCandidates = [],
    rejectedOutput,
    reason,
  }) {
    throw new Error("repair() must be implemented by an extractor provider");
  }
}

module.exports = {
  ExtractorProvider,
};
