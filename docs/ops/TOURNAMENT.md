# Model Tournament

## Overview

This document describes the manual model tournament workflow for evaluating candidate models against the current registry primary.

## Workflow

1. **Trigger the workflow**
   - Go to the Actions tab in the repository
   - Select the "Model Tournament" workflow
   - Click "Run workflow"
   - Provide the required inputs:
     - `models`: Comma-separated list of model IDs to evaluate
     - `trials`: Number of trials to run for each model (default: 3, max: 5)

2. **Workflow Execution**
   - The workflow will run the model tournament with the specified models and trials
   - Results will be uploaded as an artifact
   - A summary table will be written to the step summary

## Reading Blinded Labels

The results are labeled with blinded labels (A, B, C, etc.) to ensure fairness in evaluation.

## Promotion Rule

A candidate model replaces the incumbent only if:
- Its median success rate is higher than the incumbent's
- Its p90 cost is not higher than the incumbent's

## Monthly Cadence

The owner may schedule the workflow to run on a monthly basis to ensure regular evaluation of candidate models.
