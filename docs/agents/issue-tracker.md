# Issue tracker: GitHub Issues

Issues for this repo live in [GitHub Issues](https://github.com/sktr/egavel/issues).

## When a skill says "fetch the relevant ticket"

Use the `gh` CLI to read the issue. The user will normally pass a URL or issue number.

```
gh issue view <number>
```

## When a skill says "publish to the issue tracker"

Use the `gh` CLI to create the issue.

```
gh issue create --title "<title>" --body "<body>" --label "<label>"
```

## PRs as a request surface

External PRs are NOT triaged through the issue tracker. They are handled outside this workflow.
