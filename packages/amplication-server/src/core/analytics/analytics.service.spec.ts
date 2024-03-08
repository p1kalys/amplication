import { Test, TestingModule } from "@nestjs/testing";
import { MockedAmplicationLoggerProvider } from "@amplication/util/nestjs/logging/test-utils";
import { AnalyticsService } from "./analytics.service";
import { Project, Resource, Workspace } from "../../models";
import { Build } from "../build/dto/Build";
import { PrismaService } from "../../prisma";
import { EnumBlockType } from "../../enums/EnumBlockType";

const buildFindManyMock = jest.fn();
const buildCountMock = jest.fn();
const buildAggregateMock = jest.fn();

const entityCountMock = jest.fn();

const blockCountMock = jest.fn();

describe("AnalyticsService", () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        MockedAmplicationLoggerProvider,
        {
          provide: PrismaService,
          useValue: {
            build: {
              findMany: buildFindManyMock,
              count: buildCountMock,
              aggregate: buildAggregateMock,
            },
            entity: {
              count: entityCountMock,
            },
            block: {
              count: blockCountMock,
            },
          },
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("countLinesOfCodeAddedOrUpdatedForBuild", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.restoreAllMocks();
    });

    const now = new Date();

    it("should count the lines of code added/updated for a given project", async () => {
      const startDate = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        now.getDate()
      );
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      buildAggregateMock.mockResolvedValueOnce({
        _sum: {
          linesOfCode: 10,
        },
      });
      const result = await service.countLinesOfCode({
        workspaceId: "workspace-id",
        projectId: "project-id",
        startDate,
        endDate,
      });

      expect(buildAggregateMock).toBeCalledWith({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          resource: {
            project: {
              workspaceId: "workspace-id",
              id: "project-id",
            },
          },
        },
        _sum: {
          linesOfCode: true,
        },
      });

      expect(result).toBeDefined();
    });

    it("should count the lines of code added/updated for all projects", async () => {
      const startDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 14
      );
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      buildAggregateMock.mockResolvedValueOnce({
        _sum: {
          linesOfCode: 10,
        },
      });
      const result = await service.countLinesOfCode({
        workspaceId: "workspace-id",
        startDate,
        endDate,
      });

      expect(buildAggregateMock).toBeCalledWith({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          resource: {
            project: {
              workspaceId: "workspace-id",
              id: undefined,
            },
          },
        },
        _sum: {
          linesOfCode: true,
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe("when calculating project analytics", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.restoreAllMocks();
    });

    const now = new Date();

    const buildMock: Build = {
      id: "build-id",
      createdAt: now,
      resourceId: "resource-id",
      userId: "user-id",
      version: "",
      actionId: "",
      commitId: "",
    };
    const resourceMock: Resource = {
      id: "resource-id",
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "resource-name",
      description: "resource-description",
      project: {
        id: "project-id",
        workspaceId: "workspace-id",
      } as unknown as Project,
      builds: [buildMock],
      resourceType: "Service",
      gitRepositoryOverride: false,
      licensed: false,
    };
    const projectMock: Project = {
      id: "project-id",
      name: "project-name",
      createdAt: new Date(),
      updatedAt: new Date(),
      useDemoRepo: false,
      licensed: true,
      workspaceId: "workspace-id",
      resources: [resourceMock],
    };
    const workspaceMock: Workspace = {
      id: "workspace-id",
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "workspace-name",
      users: [],
      projects: [projectMock],
      allowLLMFeatures: false,
    };
    describe("when calculating a specific project analytics", () => {
      it("should get the number of builds for a given project in a specific time frame", async () => {
        buildCountMock.mockResolvedValueOnce(1);
        const result = await service.countProjectBuilds({
          workspaceId: workspaceMock.id,
          startDate: new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            now.getDate()
          ),
          endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          projectId: projectMock.id,
        });

        expect(buildCountMock).toBeCalledWith({
          where: {
            createdAt: {
              gte: new Date(
                now.getFullYear(),
                now.getMonth() - 1,
                now.getDate()
              ),
              lte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            },
            resource: {
              project: {
                id: projectMock.id,
                workspaceId: workspaceMock.id,
              },
            },
          },
        });

        expect(result).toBeDefined();
      });

      it("should get the number of entities created/updated for a given project in a specific time frame", async () => {
        entityCountMock.mockResolvedValueOnce(2);
        const startDate = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate()
        );
        const endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const result = await service.countEntityChanges({
          workspaceId: workspaceMock.id,
          startDate,
          endDate,
          projectId: projectMock.id,
        });

        expect(entityCountMock).toBeCalledWith({
          where: {
            resource: {
              project: {
                id: projectMock.id,
                workspaceId: workspaceMock.id,
              },
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            OR: [
              {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                updatedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            ],
            versions: {
              every: {
                fields: {
                  every: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    OR: [
                      {
                        createdAt: {
                          gte: startDate,
                          lte: endDate,
                        },
                      },
                      {
                        updatedAt: {
                          gte: startDate,
                          lte: endDate,
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        });
        expect(result).toBeDefined();
      });

      it("should get the number of Block type created/updated for a given project in a specific time frame", async () => {
        blockCountMock.mockResolvedValueOnce(2);
        const startDate = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate()
        );
        const endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const blockType = EnumBlockType.PluginInstallation;

        const result = await service.countBlockChanges({
          workspaceId: workspaceMock.id,
          startDate,
          endDate,
          projectId: projectMock.id,
          blockType,
        });

        expect(blockCountMock).toBeCalledWith({
          where: {
            blockType,
            resource: {
              project: {
                id: projectMock.id,
                workspaceId: workspaceMock.id,
              },
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            OR: [
              {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                updatedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            ],
          },
        });
        expect(result).toBeDefined();
      });
    });
    describe("when calculating the total project analytics", () => {
      it("should get the number of builds in a specific time frame", async () => {
        buildCountMock.mockResolvedValueOnce(1);
        const result = await service.countProjectBuilds({
          workspaceId: workspaceMock.id,
          startDate: new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 14
          ),
          endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        });

        expect(buildCountMock).toBeCalledWith({
          where: {
            createdAt: {
              gte: new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - 14
              ),
              lte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            },
            resource: {
              project: {
                id: undefined,
                workspaceId: workspaceMock.id,
              },
            },
          },
        });

        expect(result).toBeDefined();
      });

      it("should get the number of entities created/updated in a specific time frame", async () => {
        entityCountMock.mockResolvedValueOnce(2);
        const startDate = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate()
        );
        const endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const result = await service.countEntityChanges({
          workspaceId: workspaceMock.id,
          startDate,
          endDate,
        });

        expect(entityCountMock).toBeCalledWith({
          where: {
            resource: {
              project: {
                id: undefined,
                workspaceId: workspaceMock.id,
              },
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            OR: [
              {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                updatedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            ],
            versions: {
              every: {
                fields: {
                  every: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    OR: [
                      {
                        createdAt: {
                          gte: startDate,
                          lte: endDate,
                        },
                      },
                      {
                        updatedAt: {
                          gte: startDate,
                          lte: endDate,
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        });
        expect(result).toBeDefined();
      });

      it("should get the number of Block type created/updated in a specific time frame", async () => {
        blockCountMock.mockResolvedValueOnce(2);
        const startDate = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          now.getDate()
        );
        const endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        const blockType = EnumBlockType.ModuleAction;

        const result = await service.countBlockChanges({
          workspaceId: workspaceMock.id,
          startDate,
          endDate,
          blockType,
        });

        expect(blockCountMock).toBeCalledWith({
          where: {
            blockType,
            resource: {
              project: {
                id: undefined,
                workspaceId: workspaceMock.id,
              },
            },
            // eslint-disable-next-line @typescript-eslint/naming-convention
            OR: [
              {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                updatedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            ],
          },
        });
        expect(result).toBeDefined();
      });
    });
  });
});
