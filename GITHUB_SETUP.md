# GitHub Setup Instructions

## 1. Push to GitHub
First, ensure your code is pushed to your GitHub repository:
```bash
git add .
git commit -m "Add automated tests and CI"
git push origin main
```

## 2. Verify CI
1. Go to your repository on GitHub.
2. Click on the **Actions** tab.
3. You should see a workflow run named "CI" (or similar, based on the commit message).
4. Ensure it shows a green checkmark ✅.

## 3. Configure Branch Protection
To ensure tests pass before merging:

1. Go to your repository **Settings**.
2. On the left sidebar, click **Branches**.
3. Click **Add branch protection rule**.
4. **Branch name pattern**: `main`
5. Check **Require status checks to pass before merging**.
6. Search for and select **test** (this matches the job name in `.github/workflows/ci.yml`).
   - *Note: You might need to wait for the first CI run to complete before this option appears.*
7. Click **Create**.

Now, any Pull Request targeting `main` will require the tests to pass before it can be merged.
