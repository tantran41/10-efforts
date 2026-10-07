---
tags:
  - ⚙️
publish: false
created: 2022-04-30 0909
date: 2023-11-10 12:56:01
lastmod: 2024-03-03T18:35
---

# VAULT TASKS

## Todoist

> [!todoist]-
> ```todoist  
> name: My Tasks  
> filter: "today | overdue"  
> sorting:  
> - date  
> - priority  
> group: true
> ```

## Vault Tasks

```dataview
TASK
FROM "" AND !"5-Templates" AND !"Z/2023 Goals"
WHERE !completed
GROUP BY file.link
```
