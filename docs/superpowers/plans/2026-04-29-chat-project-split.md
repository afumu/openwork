# Chat Project Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split ordinary chats from project work so ordinary conversations never create or show OpenSandbox runtime, while project groups retain the existing workspace experience.

**Architecture:** Add a `groupType` boundary to chat groups and normalize missing values to `chat`. Backend runtime routing and runtime APIs respect this boundary. Frontend store/API surfaces the type, partitions the sidebar into conversation and project sections, and only renders workspace UI for project groups.

**Tech Stack:** NestJS + TypeORM + Jest in `service/`; Vue 3 + Pinia + Vite + node:test/tsx in `chat/`.

---

## File Structure

- Modify `service/src/modules/chatGroup/chatGroup.entity.ts`: persist `groupType`.
- Modify `service/src/modules/chatGroup/dto/createGroup.dto.ts`: accept `groupType`.
- Modify `service/src/modules/chatGroup/chatGroup.service.ts`: default and validate group type when creating.
- Modify `service/src/modules/chatGroup/chatGroup.service.spec.ts`: test default/project group creation.
- Modify `service/src/modules/aiTool/chat/runtime/runtimeWorkspace.ts`: require project group for agent routing.
- Modify `service/src/modules/aiTool/chat/runtime/runtimeWorkspace.spec.ts`: test ordinary chats bypass runtime.
- Modify `service/src/modules/chat/chat.service.ts`: pass active group type into runtime routing and guard runtime status/workspace endpoints.
- Modify `service/src/modules/chat/chat.service.spec.ts`: test runtime status does not touch OpenSandbox for ordinary chats.
- Modify `chat/src/api/group.ts`: send optional `groupType`.
- Modify `chat/src/typings/chat.d.ts`: add `groupType` to group types.
- Modify `chat/src/store/modules/chat/index.ts`: map `groupType`, add mode-aware create action.
- Add `chat/src/views/chat/groupMode.ts`: shared frontend group type helpers.
- Add `chat/src/views/chat/groupMode.test.ts`: cover normalization and partitioning.
- Modify `chat/src/views/chat/chat.vue`: create new groups in the selected mode.
- Modify `chat/src/views/chat/chatBase.vue`: only show project workspace/artifact entry for project groups.
- Modify `chat/src/views/chat/components/Footer/index.vue`: show mode tabs on empty composer and request project creation when needed.
- Modify `chat/src/views/chat/components/sider/List.vue`: split sidebar into conversations and projects.

---

### Task 1: Backend group type persistence

**Files:**
- Modify: `service/src/modules/chatGroup/chatGroup.entity.ts`
- Modify: `service/src/modules/chatGroup/dto/createGroup.dto.ts`
- Modify: `service/src/modules/chatGroup/chatGroup.service.ts`
- Test: `service/src/modules/chatGroup/chatGroup.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests that verify `create()` saves `groupType: 'chat'` by default and `groupType: 'project'` when requested.

- [ ] **Step 2: Run red test**

Run: `cd service && pnpm test chatGroup/chatGroup.service.spec.ts --runInBand`

Expected: fails because `groupType` is not saved yet.

- [ ] **Step 3: Implement groupType persistence**

Add a `groupType` column with default `chat`, accept `groupType` in `CreateGroupDto`, and normalize invalid or missing values to `chat`.

- [ ] **Step 4: Run green test**

Run: `cd service && pnpm test chatGroup/chatGroup.service.spec.ts --runInBand`

Expected: pass.

### Task 2: Backend runtime routing boundary

**Files:**
- Modify: `service/src/modules/aiTool/chat/runtime/runtimeWorkspace.ts`
- Modify: `service/src/modules/chat/chat.service.ts`
- Test: `service/src/modules/aiTool/chat/runtime/runtimeWorkspace.spec.ts`
- Test: `service/src/modules/chat/chat.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Update runtime helper tests so `shouldUseOpenSandboxAgent(..., 'chat')` is false and `shouldUseOpenSandboxAgent(..., 'project')` keeps current model behavior. Add a `ChatService.runtimeStatus` test that returns `status: 'not_project'` and does not call `openSandboxRuntimeService` for an ordinary chat group.

- [ ] **Step 2: Run red tests**

Run: `cd service && pnpm test aiTool/chat/runtime/runtimeWorkspace.spec.ts chat/chat.service.spec.ts --runInBand`

Expected: fails because routing does not yet accept group type and runtime status does not guard ordinary groups.

- [ ] **Step 3: Implement runtime boundary**

Pass active `groupType` from `ChatService.chatProcess` into `shouldUseOpenSandboxAgent`. Guard runtime status/list/read endpoints with a project-group check before touching OpenSandbox.

- [ ] **Step 4: Run green tests**

Run: `cd service && pnpm test aiTool/chat/runtime/runtimeWorkspace.spec.ts chat/chat.service.spec.ts --runInBand`

Expected: pass.

### Task 3: Frontend group mode helpers and store

**Files:**
- Add: `chat/src/views/chat/groupMode.ts`
- Add: `chat/src/views/chat/groupMode.test.ts`
- Modify: `chat/src/api/group.ts`
- Modify: `chat/src/typings/chat.d.ts`
- Modify: `chat/src/store/modules/chat/index.ts`

- [ ] **Step 1: Write failing helper tests**

Test that missing/unknown group types normalize to `chat`, `project` remains project, and partitioning separates project groups from ordinary conversations.

- [ ] **Step 2: Run red test**

Run: `cd chat && pnpm test src/views/chat/groupMode.test.ts`

Expected: fails because helper file does not exist yet.

- [ ] **Step 3: Implement helpers and store wiring**

Create `normalizeGroupType`, `isProjectGroup`, and `partitionGroupsByType`. Add optional `groupType` to create API and chat typings. Map server `groupType` in `queryMyGroup`. Let `addNewChatGroup` accept a fourth options object with `groupType`.

- [ ] **Step 4: Run green test**

Run: `cd chat && pnpm test src/views/chat/groupMode.test.ts`

Expected: pass.

### Task 4: Frontend layout and sidebar split

**Files:**
- Modify: `chat/src/views/chat/chat.vue`
- Modify: `chat/src/views/chat/chatBase.vue`
- Modify: `chat/src/views/chat/components/Footer/index.vue`
- Modify: `chat/src/views/chat/components/sider/List.vue`

- [ ] **Step 1: Write source-level regression tests**

Add or update node tests to assert `chatBase.vue` gates `RuntimeWorkspacePanel` behind project mode and `List.vue` renders separate `对话记录` and `项目` sections from partitioned groups.

- [ ] **Step 2: Run red frontend tests**

Run: `cd chat && pnpm test src/views/chat/groupMode.test.ts src/utils/chatHistoryRefresh.test.ts`

Expected: new source checks fail before UI wiring.

- [ ] **Step 3: Implement UI wiring**

Add empty-state mode tabs to the composer, create `project` groups when project mode is selected, split sidebar sections, and hide workspace/artifact entry unless active group is project.

- [ ] **Step 4: Run green frontend tests**

Run: `cd chat && pnpm test src/views/chat/groupMode.test.ts src/utils/chatHistoryRefresh.test.ts`

Expected: pass.

### Task 5: Final verification

**Files:**
- All touched files.

- [ ] **Step 1: Run targeted backend tests**

Run: `cd service && pnpm test chatGroup/chatGroup.service.spec.ts aiTool/chat/runtime/runtimeWorkspace.spec.ts chat/chat.service.spec.ts --runInBand`

Expected: pass.

- [ ] **Step 2: Run targeted frontend tests**

Run: `cd chat && pnpm test src/views/chat/groupMode.test.ts src/utils/chatHistoryRefresh.test.ts`

Expected: pass.

- [ ] **Step 3: Run type/build checks where practical**

Run: `cd chat && pnpm type-check`

Expected: pass, or report existing unrelated failures if the repo baseline is not clean.

