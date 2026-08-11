# Private Studio Editor overrides

Mastra Studio's code-source Editor writes reviewable per-agent JSON changes in
this directory. Assistant V3 permits only tool-description overrides.
Instructions, tool membership, model settings, workflows, scorers, policy, and
customer-runtime behavior remain code-owned.

Generated override files must be reviewed, tested, and committed like source
code. The customer application bootstrap does not mount the Editor, so an
unreviewed local Studio draft cannot alter a customer response.
