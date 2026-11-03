// Local workflow preference; GitLab protection remains enforced by the server.
export function canMergeInto(branch:string|null|undefined):boolean {
  return !!branch && !/^(master|main)$/i.test(branch);
}
