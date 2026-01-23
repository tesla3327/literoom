Manual Testing

Issues:

- Sometimes, if I load up the app or if I click "Select Folder," but I've already previously loaded a folder, it will load the previous one, which seems like a bad UX. Maybe instead of "Select Folder," we could do "Previously Opened Folders," and we can have a list of them so we can just jump straight in.
- The import UX is pretty weird and feels really slow, so I wonder if we can do a few things to improve that:
1. In the toolbar, we show scanning (only for scanning the actual files), but that disappears. We should also show a progress for the whole import thing, so we can say like we're scanning, then we are processing the thumbnails, and then processing the preview images. That all should be part of the import process.
2. Show a progress bar where it says "scanning" in the top, so that the user can see how it's going.
3. I wonder if in terms of UX, it might feel a bit faster if instead of dropping straight into the gallery and just having a bunch of loading things, we first have an interstitial or a modal that shows like "loading" or something like that.
4. Basically make sure that the first page of thumbnails is processed before dropping them into the gallery.
5. When they get dropped into the gallery, all their thumbnails are loaded.
6. As they start to look around the thumbnails and the previews for the other photos continue to go, so we're sort of weaving a bit that the first set of thumbnails is already processed.
So when they jump in, it feels like they can do stuff with the application already.

There's also the issue of when I an image looks like it's loaded and so I, because the thumbnail is there, double-click to go into the edit, and then it says it's generating the preview still. I'm wondering if there's a way to basically optimize these things so that we can improve the UX as much as possible. Maybe we process everything up front and we wait to drop the user in till everything is processed. Or if someone goes into an edit page and the preview hasn't been generated, we prioritize generating that preview so that it's going to be generated. And so we stop generating all the other thumbnails until that's happening. We have some sort of processing queue and things can jump the queue based on priority so that the UX is really good. Okay.

Every time I go into a photo to the edit page and then go back to the gallery, the all count keeps increasing, so there's a bug there.

When I go back to the gallery from the edit page, sometimes the loading state is just shown, no thumbnails are shown, and the thumbnails aren't updated; they're not regenerated as the photo is being edited.

Exporting also doesn't use the edits. It exports the original image just fine, but it doesn't export the edited image.