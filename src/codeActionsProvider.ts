import * as vscode from "vscode";

export class CodeActionsProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
  ];

  constructor(private context: vscode.ExtensionContext) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const selectedText = document.getText(range);

    if (!selectedText || selectedText.trim().length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // Add "Explain with Perplexity" action
    const explainAction = new vscode.CodeAction(
      "Explain with Perplexity AI",
      vscode.CodeActionKind.QuickFix
    );
    explainAction.command = {
      command: "perplexity-ai.explainCode",
      title: "Explain Code",
    };
    actions.push(explainAction);

    // Add "Optimize with Perplexity" action
    const optimizeAction = new vscode.CodeAction(
      "Optimize with Perplexity AI",
      vscode.CodeActionKind.Refactor
    );
    optimizeAction.command = {
      command: "perplexity-ai.optimizeCode",
      title: "Optimize Code",
    };
    actions.push(optimizeAction);

    // Add "Find Bugs with Perplexity" action
    const findBugsAction = new vscode.CodeAction(
      "Find Bugs with Perplexity AI",
      vscode.CodeActionKind.QuickFix
    );
    findBugsAction.command = {
      command: "perplexity-ai.findBugs",
      title: "Find Bugs",
    };
    actions.push(findBugsAction);

    // Add "Generate Tests" action
    const testsAction = new vscode.CodeAction(
      "Generate Tests with Perplexity AI",
      vscode.CodeActionKind.Refactor
    );
    testsAction.command = {
      command: "perplexity-ai.generateTests",
      title: "Generate Tests",
    };
    actions.push(testsAction);

    return actions;
  }

  output = vscode.window.createOutputChannel("Perplexity AI");
}
