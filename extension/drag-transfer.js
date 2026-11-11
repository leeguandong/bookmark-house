// Collecting a link never asks its source to move/delete the original.
// Native browser URL drags can permit only "link", rather than "copy".
export function externalLinkDropEffect(transfer){
  switch(transfer?.effectAllowed||'uninitialized'){
    case 'copy':case 'copyLink':case 'copyMove':case 'all':case 'uninitialized':return 'copy';
    case 'link':case 'linkMove':return 'link';
    default:return 'none';
  }
}
