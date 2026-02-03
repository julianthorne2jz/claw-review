#!/usr/bin/env node
const { program } = require('commander');
const chalk = require('chalk');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Helper to run shell commands
function run(cmd, options = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', ...options }).trim();
    } catch (e) {
        if (options.ignoreError) return '';
        throw e;
    }
}

async function callGemini(prompt) {
    return new Promise((resolve, reject) => {
        // Escape quotes in prompt for shell
        // This is tricky. Better to write prompt to a temp file and pipe it?
        // Or just use basic escaping.
        // Let's try passing it via env var or just careful escaping.
        // Actually, gemini CLI takes positional args.
        
        // Safer approach: use exec with maxBuffer
        const safePrompt = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');
        exec(`gemini "${safePrompt}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                // If gemini fails, maybe it's too long?
                reject(stderr || error.message);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

const SYSTEM_PROMPT = `You are a senior software engineer conducting a code review. 
Analyze the provided code/diff and identify:
1. Critical Bugs 🐛
2. Security Vulnerabilities 🔓
3. Performance Issues 🐌
4. Best Practices/Refactoring 💡

Be concise. Do not explain what the code does unless it's unclear. 
If the code is good, say "LGTM (Looks Good To Me) ✨".
Format your response in Markdown.`;

async function review(content, context = '') {
    if (!content.trim()) {
        console.log(chalk.yellow('No content to review.'));
        return;
    }

    console.log(chalk.blue('🤖 analyzing...'));
    
    const prompt = `${SYSTEM_PROMPT}\n\nCONTEXT: ${context}\n\nCODE:\n\`\`\`diff\n${content}\n\`\`\``;
    
    try {
        const result = await callGemini(prompt);
        console.log('\n' + chalk.bold.underline('Review Report:') + '\n');
        console.log(result);
    } catch (e) {
        console.error(chalk.red('Error calling Gemini:'), e);
    }
}

program
    .name('claw-review')
    .description('AI-powered code reviewer for agents')
    .version('1.0.0');

program
    .command('diff')
    .description('Review current git changes (unstaged + staged)')
    .action(async () => {
        try {
            let diff = run('git diff', { ignoreError: true });
            if (!diff) {
                diff = run('git diff --cached', { ignoreError: true });
                if (diff) console.log(chalk.dim('(Reviewing staged changes)'));
            } else {
                console.log(chalk.dim('(Reviewing unstaged changes)'));
            }

            if (!diff) {
                console.log(chalk.green('Working tree clean. Nothing to review.'));
                return;
            }

            // Truncate if too huge (Gemini has limits)
            if (diff.length > 50000) {
                console.warn(chalk.yellow('Diff is very large (>50k chars). Truncating...'));
                diff = diff.substring(0, 50000) + '\n... (truncated)';
            }

            await review(diff, 'Git Diff');
        } catch (e) {
            console.error(chalk.red('Error getting diff:'), e.message);
        }
    });

program
    .command('file <path>')
    .description('Review a specific file')
    .action(async (filePath) => {
        try {
            const absolutePath = path.resolve(filePath);
            if (!fs.existsSync(absolutePath)) {
                console.error(chalk.red('File not found:'), filePath);
                process.exit(1);
            }
            const content = fs.readFileSync(absolutePath, 'utf8');
            await review(content, `File: ${filePath}`);
        } catch (e) {
            console.error(chalk.red('Error reading file:'), e.message);
        }
    });

// Default action: diff
if (process.argv.length === 2) {
    process.argv.push('diff');
}

program.parse(process.argv);
