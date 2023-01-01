import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { App, Octokit } from "octokit";
import { GithubFile } from "./dto/github-file.dto";
import { ConverterUtil } from "../utils/convert-to-number";
import { createAppAuth } from "@octokit/auth-app";
import { createPullRequest } from "octokit-plugin-create-pull-request";
import {
  AMPLICATION_IGNORED_FOLDER,
  UNSUPPORTED_GIT_ORGANIZATION_TYPE,
} from "./git.constants";
import { components } from "@octokit/openapi-types";
import { join } from "path";
import { AmplicationIgnoreManger } from "../utils/amplication-ignore-manger";
import {
  EnumGitOrganizationType,
  GitResourceMeta,
  PrModule,
} from "./git.types";
import {
  RemoteGitRepos,
  RemoteGitRepository,
} from "./dto/remote-git-repository";
import { RemoteGitOrganization } from "./dto/remote-git-organization.dto";
import { Branch } from "./dto/branch";

const GITHUB_FILE_TYPE = "file";
export const GITHUB_CLIENT_SECRET_VAR = "GITHUB_CLIENT_SECRET";
export const GITHUB_APP_APP_ID_VAR = "GITHUB_APP_APP_ID";
export const GITHUB_APP_PRIVATE_KEY_VAR = "GITHUB_APP_PRIVATE_KEY";
export const GITHUB_APP_INSTALLATION_URL_VAR = "GITHUB_APP_INSTALLATION_URL";
export const UNEXPECTED_FILE_TYPE_OR_ENCODING = `Unexpected file type or encoding received`;

const fileModeCode = "100644";

type DirectoryItem = components["schemas"]["content-directory"][number];
@Injectable()
export class GithubService {
  private app: App;
  private gitInstallationUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.gitInstallationUrl = this.configService.get(
      GITHUB_APP_INSTALLATION_URL_VAR
    );

    const appId = this.configService.get(GITHUB_APP_APP_ID_VAR);
    const privateKey = this.configService
      .get(GITHUB_APP_PRIVATE_KEY_VAR)
      .replace(/\\n/g, "\n");

    this.app = new App({
      appId: appId,
      privateKey: privateKey,
    });
  }
  createUserRepository(
    installationId: string,
    owner: string,
    name: string,
    isPublic: boolean
  ): Promise<RemoteGitRepository> {
    console.log({ installationId, owner, name, isPublic });
    throw new Error(UNSUPPORTED_GIT_ORGANIZATION_TYPE);
  }
  async createOrganizationRepository(
    installationId: string,
    owner: string,
    name: string,
    isPublic: boolean
  ): Promise<RemoteGitRepository> {
    const octokit = await this.getInstallationOctokit(installationId);

    const exists: boolean = await GithubService.isRepoExistWithOctokit(
      octokit,
      name
    );
    if (exists) {
      return null;
    }

    const { data: repo } = await octokit.rest.repos.createInOrg({
      name: name,
      org: owner,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      auto_init: true,
      private: !isPublic,
    });

    return {
      name: repo.name,
      url: repo.html_url,
      private: repo.private,
      fullName: repo.full_name,
      admin: repo.permissions?.admin || false,
      defaultBranch: repo.default_branch,
    };
  }
  async getOrganizationRepos(
    installationId: string,
    limit: number,
    page: number
  ): Promise<RemoteGitRepos> {
    const octokit = await this.getInstallationOctokit(installationId);
    return await GithubService.getOrganizationReposWithOctokitAndPagination(
      octokit,
      limit,
      page
    );
  }

  async isRepoExist(installationId: string, name: string): Promise<boolean> {
    const octokit = await this.getInstallationOctokit(installationId);
    return await GithubService.isRepoExistWithOctokit(octokit, name);
  }
  async getGitInstallationUrl(workspaceId: string): Promise<string> {
    return this.gitInstallationUrl.replace("{state}", workspaceId);
  }
  async deleteGitOrganization(installationId: string): Promise<boolean> {
    const octokit = await this.getInstallationOctokit(installationId);
    const deleteInstallationRes = await octokit.rest.apps.deleteInstallation({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      installation_id: ConverterUtil.convertToNumber(installationId),
    });

    if (deleteInstallationRes.status != 204) {
      return false;
    }

    return true;
  }
  async getGitRemoteOrganization(
    installationId: string
  ): Promise<RemoteGitOrganization> {
    const octokit = await this.getInstallationOctokit(installationId);
    const gitRemoteOrganization = await octokit.rest.apps.getInstallation({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      installation_id: ConverterUtil.convertToNumber(installationId),
    });
    const { data: gitRemoteOrgs } = gitRemoteOrganization;

    return {
      name: gitRemoteOrgs.account.login,
      type: EnumGitOrganizationType[gitRemoteOrganization.data.account.type],
    };
  }
  async getFile(
    userName: string,
    repoName: string,
    path: string,
    baseBranchName: string,
    installationId: string
  ): Promise<GithubFile> {
    const octokit = await this.getInstallationOctokit(installationId);
    const content = await octokit.rest.repos.getContent({
      owner: userName,
      repo: repoName,
      path,
      ref: baseBranchName ? baseBranchName : undefined,
    });

    if (!Array.isArray(content)) {
      const item = content.data as DirectoryItem;

      if (item.type === GITHUB_FILE_TYPE) {
        // Convert base64 results to UTF-8 string
        const buff = Buffer.from(item.content, "base64");

        const file: GithubFile = {
          content: buff.toString("utf-8"),
          htmlUrl: item.html_url,
          name: item.name,
          path: item.path,
        };
        return file;
      }
    }
    return null;
  }

  async createPullRequest(
    owner: string,
    repo: string,
    modules: PrModule[],
    commitMessage: string,
    prTitle: string,
    prBody: string,
    installationId: string,
    head = "amplication",
    gitResourceMeta: GitResourceMeta,
    baseBranchName?: string | undefined
  ): Promise<string> {
    const myOctokit = Octokit.plugin(createPullRequest);
    const token = await this.getInstallationAuthToken(installationId);
    const octokit = new myOctokit({
      auth: token,
    });

    const amplicationIgnoreManger = new AmplicationIgnoreManger();
    await amplicationIgnoreManger.init(async (fileName) => {
      try {
        return (
          await this.getFile(
            owner,
            repo,
            fileName,
            baseBranchName,
            installationId
          )
        ).content;
      } catch (error) {
        console.log("Repository does not have a .amplicationignore file");
        return "";
      }
    });

    //do not override files in 'server/src/[entity]/[entity].[controller/resolver/service/module].ts'
    //do not override server/scripts/customSeed.ts
    const doNotOverride = [
      new RegExp(
        `^${gitResourceMeta.serverPath || "server"}/src/[^/]+/.+.controller.ts$`
      ),
      new RegExp(
        `^${gitResourceMeta.serverPath || "server"}/src/[^/]+/.+.resolver.ts$`
      ),
      new RegExp(
        `^${gitResourceMeta.serverPath || "server"}/src/[^/]+/.+.service.ts$`
      ),
      new RegExp(
        `^${gitResourceMeta.serverPath || "server"}/src/[^/]+/.+.module.ts$`
      ),
      new RegExp(
        `^${gitResourceMeta.serverPath || "server"}/scripts/customSeed.ts$`
      ),
    ];

    const authFolder = "server/src/auth";

    const files = Object.fromEntries(
      modules.map((module) => {
        // ignored file
        if (amplicationIgnoreManger.isIgnored(module.path)) {
          return [join(AMPLICATION_IGNORED_FOLDER, module.path), module.code];
        }
        // Deleted file
        if (module.code === null) {
          return [module.path, module.code];
        }
        // Regex ignored file
        if (
          !module.path.startsWith(authFolder) &&
          doNotOverride.some((rx) => rx.test(module.path))
        ) {
          return [
            module.path,
            ({ exists }) => {
              // do not create the file if it already exist
              if (exists) return null;

              return module.code;
            },
          ];
        }
        // Regular file
        return [module.path, module.code];
      })
    );

    const {
      data: [existingPR],
    } = await octokit.rest.pulls.list({
      owner,
      repo,
      baseBranchName,
      head,
    });

    if (!existingPR) {
      // Returns a normal Octokit PR response
      // See https://octokit.github.io/rest.js/#octokit-routes-pulls-create
      const pr = await octokit.createPullRequest({
        owner,
        repo,
        title: prTitle,
        body: prBody,
        base: baseBranchName /* optional: defaults to default branch */,
        head,
        update: true,
        changes: [
          {
            /* optional: if `files` is not passed, an empty commit is created instead */
            files: files,
            commit: commitMessage,
          },
        ],
      });
      return pr.data.html_url;
    }
    await this.createCommit(
      installationId,
      owner,
      repo,
      commitMessage,
      head,
      files
    );
    return existingPR.html_url;
  }

  private async getInstallationOctokit(
    installationId: string
  ): Promise<Octokit> {
    const installationIdNumber = ConverterUtil.convertToNumber(installationId);
    return await this.app.getInstallationOctokit(installationIdNumber);
  }

  private static async getOrganizationReposWithOctokit(
    octokit: Octokit
  ): Promise<RemoteGitRepository[]> {
    const results = await octokit.request("GET /installation/repositories");
    return results.data.repositories.map((repo) => ({
      name: repo.name,
      url: repo.html_url,
      private: repo.private,
      fullName: repo.full_name,
      admin: repo.permissions.admin,
      defaultBranch: repo.default_branch,
    }));
  }

  private static async getOrganizationReposWithOctokitAndPagination(
    octokit: Octokit,
    limit = 10,
    page = 1
  ): Promise<RemoteGitRepos> {
    const results = await octokit.request(
      `GET /installation/repositories?per_page=${limit}&page=${page}`
    );
    const repos = results.data.repositories.map((repo) => ({
      name: repo.name,
      url: repo.html_url,
      private: repo.private,
      fullName: repo.full_name,
      admin: repo.permissions.admin,
    }));

    return {
      totalRepos: results.data.total_count,
      repos: repos,
      pageSize: limit,
      currentPage: page,
    };
  }

  private static async isRepoExistWithOctokit(
    octokit: Octokit,
    name: string
  ): Promise<boolean> {
    const repos = await GithubService.getOrganizationReposWithOctokit(octokit);
    return repos.map((repo) => repo.name).includes(name);
  }
  private async getInstallationAuthToken(
    installationId: string
  ): Promise<string> {
    const appId = this.configService.get(GITHUB_APP_APP_ID_VAR);
    const privateKey = this.configService
      .get(GITHUB_APP_PRIVATE_KEY_VAR)
      .replace(/\\n/g, "\n");
    const auth = createAppAuth({ appId, privateKey });
    // Retrieve installation access token
    return (
      await auth({
        type: "installation",
        installationId: installationId,
      })
    ).token;
  }

  async getRepository(
    installationId: string,
    owner: string,
    repo: string
  ): Promise<RemoteGitRepository> {
    const octokit = await this.getInstallationOctokit(installationId);
    const response = await octokit.rest.repos.get({
      owner,
      repo,
    });
    const {
      name,
      html_url,
      private: isPrivate,
      default_branch: defaultBranch,
      full_name: fullName,
      permissions,
    } = response.data;
    const { admin } = permissions;
    return {
      name,
      url: html_url,
      private: isPrivate,
      fullName,
      admin,
      defaultBranch,
    };
  }

  async createBranch(
    installationId: string,
    owner: string,
    repo: string,
    newBranchName: string,
    baseBranchName?: string
  ): Promise<Branch> {
    const octokit = await this.getInstallationOctokit(installationId);
    const repository = await this.getRepository(installationId, owner, repo);
    const { defaultBranch } = repository;
    const refs = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranchName || defaultBranch}`,
    });
    const { data: branch } = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranchName}`,
      sha: refs.data.object.sha,
    });
    return { name: newBranchName, sha: branch.object.sha };
  }

  async isBranchExist(
    installationId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<boolean> {
    try {
      const refs = await this.getBranch(installationId, owner, repo, branch);
      return Boolean(refs);
    } catch (error) {
      return false;
    }
  }

  async getBranch(
    installationId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<Branch> {
    const octokit = await this.getInstallationOctokit(installationId);
    const refs = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return { sha: refs.data.object.sha, name: branch };
  }

  async createCommit(
    installationId: string,
    owner: string,
    repo: string,
    message: string,
    branchName: string,
    changes: any
  ) {
    const octokit = await this.getInstallationOctokit(installationId);
    const changesArray = Object.entries(changes).map(([path, content]) => ({
      path,
      mode: fileModeCode,
      content,
    }));
    const lastCommit = await this.getLastCommit(
      installationId,
      owner,
      repo,
      branchName
    );
    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: lastCommit.commit.tree.sha,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      tree: changesArray,
    });
    const { data: commit } = await octokit.rest.git.createCommit({
      message,
      owner,
      repo,
      tree: tree.sha,
      parents: [lastCommit.sha],
    });
    await octokit.rest.git.updateRef({
      owner,
      repo,
      sha: commit.sha,
      ref: `heads/${branchName}`,
    });
  }

  async getLastCommit(
    installationId: string,
    owner: string,
    repo: string,
    branchName: string
  ) {
    const octokit = await this.getInstallationOctokit(installationId);
    const branch = await this.getBranch(
      installationId,
      owner,
      repo,
      branchName
    );
    const [lastCommit] = (
      await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branch.sha,
      })
    ).data;
    return lastCommit;
  }
}
